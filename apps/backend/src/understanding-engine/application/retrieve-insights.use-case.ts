import { Injectable, Logger } from '@nestjs/common';
import {
  InsightStatus,
  InsightType,
  KnowledgeItemStatus,
  Prisma,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isEmptyScope,
  scopeFilter,
  type KnowledgeScope,
} from '../../knowledge-engine/domain/knowledge-scope';
import { TERMINAL_INSIGHT_STATUSES } from '../domain/insight-status.classification';
import { TERMINAL_KNOWLEDGE_ITEM_STATUSES } from '../../knowledge-engine/domain/knowledge-item-status.classification';
import {
  applyInsightDecay,
  evaluateFreshness,
  type EvidenceState,
  type EvidenceFreshness,
} from '../domain/insight-freshness';
import {
  MAX_CURATION_LOOKBACK,
  resolveEffectiveCuration,
  type CuratedVersion,
  type EffectiveCuration,
} from '../domain/belief-curation';

/**
 * `RetrieveInsights` — UNDERSTANDING_ENGINE_DESIGN.md §12, subfase 3.6.
 *
 * ÚNICO punto de lectura de la comprensión. Sin consumidores conectados todavía (§18): se
 * valida de forma aislada, mismo criterio de salida que el Retriever del Knowledge Engine
 * antes de exponerse a cualquier superficie.
 *
 * El grafo de evidencia NUNCA se recorre aquí: se recorrió una sola vez al construir el
 * `TransitiveEvidenceClosure` (§3.4). La lectura parte siempre de ese conjunto plano y
 * resuelve el estado actual de sus evidencias en UNA operación.
 */

export interface RetrieveInsightsParams {
  /** Obligatorio y no negociable, igual que el filtro de organización del Retriever. */
  organizationId: string;
  types?: InsightType[];
  minimumConfidence?: number;
  /**
   * Alcance de conocimiento del consumidor (§3.4, §12). OBLIGATORIO desde 6.3.
   *
   * Antes era opcional y omitirlo devolvía TODA la comprensión de la organización. Ahora
   * omitirlo no compila, y leerla entera exige declararlo con motivo.
   */
  scope: KnowledgeScope;
  /**
   * Acota a unos identificadores concretos (6.1). Existe para que leer UN `Insight` recorra
   * exactamente el mismo camino que leer la lista —decaimiento, frescura y curación
   * incluidos— en vez de tener una segunda proyección que podría divergir.
   */
  insightIds?: string[];
  /** Exige vigencia estricta: excluye los que no se lean como frescos. */
  requireFresh?: boolean;
  /** Ancla de negocio concreta. */
  businessObjectiveId?: string;
  limit?: number;
  /** Desplazamiento de página, aplicado en SQL (6.4). */
  offset?: number;
  /** Modo histórico (§12): incluye estados terminales. NUNCA afecta a la autorización. */
  historicalMode?: boolean;
}

export interface RetrievedInsight {
  id: string;
  type: InsightType;
  summary: string;
  status: InsightStatus;
  /** Confianza con el decaimiento ya aplicado (§9). */
  confidence: number;
  /** Proyección viva, nunca un estado persistido (§3.4). */
  freshness: EvidenceFreshness;
  freshnessRationale: string;
  strategyKey: string;
  strategyVersion: string;
  reasoningTrace: unknown;
  evidence: { kind: string; role: string; refId: string | null }[];
  businessObjectives: { id: string; statement: string }[];
  /**
   * Curación humana vigente, si la hay: tiene prioridad sobre el recálculo (§3.7).
   *
   * Puede ser PROPIA de esta versión o HEREDADA de una anterior de la misma creencia (7.1).
   * Viaja siempre declarada: una heredada nunca se presenta como si la persona se hubiera
   * pronunciado sobre la afirmación actual.
   */
  curation: EffectiveCuration | null;
  createdAt: Date;
}

/** Tamaño de página por defecto y techo duro: una petición no puede pedir "todo". */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

@Injectable()
export class RetrieveInsightsUseCase {
  private readonly logger = new Logger(RetrieveInsightsUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  async execute(params: RetrieveInsightsParams): Promise<RetrievedInsight[]> {
    // Sin ninguna colección concedida no hay comprensión accesible. Se corta antes de
    // consultar: es la respuesta correcta, no un caso degenerado.
    if (isEmptyScope(params.scope)) return [];

    if (params.scope.mode === 'ORGANIZATION_WIDE') {
      this.logger.debug(
        `Lectura de comprensión de alcance ORGANIZATION_WIDE en ` +
          `${params.organizationId}: ${params.scope.reason}`,
      );
    }

    const allowedCollectionIds = scopeFilter(params.scope);
    const now = new Date();

    // Selección de IDENTIFICADORES en Postgres (6.4). Antes se cargaba la organización
    // entera y se filtraba en memoria, y el alcance efectivo de cada `Insight` se proyectaba
    // con UNA CONSULTA POR INSIGHT — un N+1 que crecía con el tamaño del tenant.
    const ids = await this.selectInsightIds(params, allowedCollectionIds);
    if (ids.length === 0) return [];

    const insights = await this.prisma.insight.findMany({
      where: {
        id: { in: ids },
        // El filtro de organización se repite: la selección anterior ya lo aplicó, y aun
        // así esta consulta no debe poder devolver nada de otro tenant por su cuenta.
        organizationId: params.organizationId,
      },
      include: {
        evidence: true,
        objectiveLinks: { include: { businessObjective: true } },
        feedback: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Cadena de supersesión de los que se van a devolver, para poder resolver la curación
    // heredada (§3.7, 7.1). Se carga por NIVELES, no por Insight: una consulta por escalón
    // de profundidad, no un N+1 que creciera con el tamaño de la página.
    const chain = await this.loadCurationChain(params.organizationId, insights);

    // Una sola resolución del estado actual de TODAS las evidencias implicadas: es lo que
    // hace implementable la garantía de vista consistente (§3.4), y lo que sería imposible
    // con un recorrido recursivo por Insight.
    const evidenceStates = await this.resolveEvidenceStates(
      params.organizationId,
      insights,
    );

    const results: RetrievedInsight[] = [];

    for (const insight of insights) {
      const closure = this.parseClosure(insight.transitiveEvidenceClosure);
      const states = closure.map(
        (ref) =>
          evidenceStates.get(ref.refId) ?? {
            refId: ref.refId,
            lastChangedAt: null,
            // Una referencia que no resuelve contra nada existente es irresoluble: se
            // trata como fail-closed, nunca como si estuviera intacta.
            unresolvable: true,
          },
      );

      const freshnessResult = evaluateFreshness({
        computedAt: insight.confidenceComputedAt,
        evidenceStates: states,
      });

      if (params.requireFresh && freshnessResult.freshness !== 'FRESH')
        continue;

      // Curación humana: PRIORITARIA sobre cualquier recálculo automático (§3.7). Desde 7.1
      // se resuelve sobre la CADENA: versionar una creencia ya no descarta el juicio de la
      // persona que la había curado.
      const curation = resolveEffectiveCuration(insight.id, chain);

      const confidence = curation
        ? insight.confidence
        : applyInsightDecay({
            currentConfidence: insight.confidence,
            computedAt: insight.confidenceComputedAt,
            now,
            type: insight.type,
          });

      if (
        params.minimumConfidence !== undefined &&
        confidence < params.minimumConfidence
      ) {
        continue;
      }

      results.push({
        id: insight.id,
        type: insight.type,
        summary: insight.summary,
        status: insight.status,
        confidence,
        freshness: freshnessResult.freshness,
        freshnessRationale: freshnessResult.rationale,
        strategyKey: insight.strategyKey,
        strategyVersion: insight.strategyVersion,
        reasoningTrace: insight.reasoningTrace,
        evidence: insight.evidence.map((e) => ({
          kind: e.kind,
          role: e.role,
          refId: e.knowledgeItemId ?? e.knowledgeChunkId ?? e.derivedInsightId,
        })),
        businessObjectives: insight.objectiveLinks.map((l) => ({
          id: l.businessObjective.id,
          statement: l.businessObjective.statement,
        })),
        curation,
        createdAt: insight.createdAt,
      });
    }

    // La página ya viene acotada por SQL. Lo que queda aquí son filtros DERIVADOS que no
    // pueden expresarse en la consulta —el decaimiento de confianza y la frescura se
    // calculan sobre el estado vivo de la evidencia—, así que una página puede devolver
    // menos elementos que el `limit` pedido. Es preferible a duplicar el decaimiento en SQL:
    // dos implementaciones de la misma curva serían dos criterios de confianza.
    return results;
  }

  /**
   * Identificadores de la página, resueltos ENTERAMENTE en Postgres (6.4).
   *
   * Aquí viven los filtros que sí son expresables en SQL: organización, exclusión de estados
   * terminales, tipo, objetivo de negocio y —lo importante— la regla de cobertura completa
   * del `EffectiveCollectionScope`.
   *
   * `<@` es "contenido en": el alcance efectivo del `Insight` debe ser un subconjunto de lo
   * concedido, que es literalmente la regla ALL (§3.4). `cardinality(...) > 0` conserva el
   * fail-closed del alcance vacío — evidencia sin colección o irresoluble es inaccesible por
   * defecto, nunca visible para todos.
   *
   * El alcance se proyecta con un `LATERAL` sobre el cierre de evidencia, protegido por
   * `jsonb_typeof = 'array'`: un cierre malformado produce alcance vacío y por tanto queda
   * excluido, en vez de reventar la consulta.
   */
  private async selectInsightIds(
    params: RetrieveInsightsParams,
    allowedCollectionIds: string[] | null,
  ): Promise<string[]> {
    const terminal = [...TERMINAL_INSIGHT_STATUSES] as string[];

    const statusFilter = params.historicalMode
      ? Prisma.empty
      : Prisma.sql`AND i."status"::text <> ALL(${terminal}::text[])`;

    const typeFilter = params.types?.length
      ? Prisma.sql`AND i."type"::text = ANY(${params.types.map(String)}::text[])`
      : Prisma.empty;

    const idFilter = params.insightIds?.length
      ? Prisma.sql`AND i."id" = ANY(${params.insightIds}::text[])`
      : Prisma.empty;

    const objectiveFilter = params.businessObjectiveId
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM "InsightObjectiveLink" l
          WHERE l."insightId" = i."id"
            AND l."businessObjectiveId" = ${params.businessObjectiveId})`
      : Prisma.empty;

    // La cobertura solo se compara cuando el alcance ES por colecciones. El de organización
    // completa la omite por diseño: lo usa el razonamiento (§3.4).
    const coverage =
      allowedCollectionIds === null
        ? Prisma.empty
        : Prisma.sql`HAVING cardinality(
             COALESCE(
               array_agg(DISTINCT kic."knowledgeCollectionId")
                 FILTER (WHERE kic."knowledgeCollectionId" IS NOT NULL),
               '{}'::text[])) > 0
           AND COALESCE(
               array_agg(DISTINCT kic."knowledgeCollectionId")
                 FILTER (WHERE kic."knowledgeCollectionId" IS NOT NULL),
               '{}'::text[]) <@ ${allowedCollectionIds}::text[]`;

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT i."id"
      FROM "Insight" i
      LEFT JOIN LATERAL (
        SELECT jsonb_array_elements(i."transitiveEvidenceClosure") AS el
        WHERE jsonb_typeof(i."transitiveEvidenceClosure") = 'array'
      ) c ON TRUE
      LEFT JOIN "KnowledgeItemCollection" kic
        ON kic."knowledgeItemId" = (c.el->>'refId')
       AND kic."organizationId" = i."organizationId"
      WHERE i."organizationId" = ${params.organizationId}
        ${statusFilter}
        ${typeFilter}
        ${idFilter}
        ${objectiveFilter}
      GROUP BY i."id", i."createdAt"
      ${coverage}
      ORDER BY i."createdAt" DESC
      LIMIT ${Math.min(params.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)}
      OFFSET ${Math.max(params.offset ?? 0, 0)}
    `;

    return rows.map((row) => row.id);
  }

  /**
   * Estado actual de todas las evidencias implicadas, en una única consulta por tipo.
   * Devuelve HECHOS —cuándo cambió, si sigue existiendo—; la interpretación de si eso
   * invalida un razonamiento la hace `evaluateFreshness`, en este dominio.
   */
  private async resolveEvidenceStates(
    organizationId: string,
    insights: { transitiveEvidenceClosure: Prisma.JsonValue }[],
  ): Promise<Map<string, EvidenceState>> {
    const refIds = [
      ...new Set(
        insights.flatMap((i) =>
          this.parseClosure(i.transitiveEvidenceClosure).map((c) => c.refId),
        ),
      ),
    ];
    const states = new Map<string, EvidenceState>();
    if (refIds.length === 0) return states;

    const items = await this.prisma.knowledgeItem.findMany({
      where: { id: { in: refIds }, organizationId },
      select: {
        id: true,
        status: true,
        confidenceComputedAt: true,
        indexedAt: true,
        createdAt: true,
      },
    });

    for (const item of items) {
      const isTerminal = (
        TERMINAL_KNOWLEDGE_ITEM_STATUSES as KnowledgeItemStatus[]
      ).includes(item.status);

      states.set(item.id, {
        refId: item.id,
        lastChangedAt:
          item.confidenceComputedAt ?? item.indexedAt ?? item.createdAt,
        // Un ítem reemplazado o eliminado ya no sostiene nada.
        unresolvable: isTerminal,
      });
    }

    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: { id: { in: refIds }, organizationId },
      select: { id: true, createdAt: true },
    });
    for (const chunk of chunks) {
      states.set(chunk.id, {
        refId: chunk.id,
        lastChangedAt: chunk.createdAt,
        unresolvable: false,
      });
    }

    const citedInsights = await this.prisma.insight.findMany({
      where: { id: { in: refIds }, organizationId },
      select: { id: true, status: true, confidenceComputedAt: true },
    });
    for (const cited of citedInsights) {
      states.set(cited.id, {
        refId: cited.id,
        lastChangedAt: cited.confidenceComputedAt,
        // Un Insight citado que fue descartado o superado deja de sostener al que lo cita.
        unresolvable: (
          [...TERMINAL_INSIGHT_STATUSES] as InsightStatus[]
        ).includes(cited.status),
      });
    }

    return states;
  }

  /**
   * Cadena de supersesión de los `Insight` que se van a devolver, hacia atrás.
   *
   * Se recorre por NIVELES: en cada vuelta se piden de golpe todas las predecesoras
   * pendientes. El coste es una consulta por escalón de profundidad de la cadena más larga,
   * no una por `Insight` — que es lo que convertiría la lectura en un N+1 al crecer el
   * tenant, justo lo que 6.4 quitó de esta ruta.
   *
   * El filtro de organización va en cada vuelta: una cadena no puede salirse del tenant.
   */
  private async loadCurationChain(
    organizationId: string,
    insights: {
      id: string;
      status: InsightStatus;
      supersedesInsightId: string | null;
      reasoningTrace: Prisma.JsonValue;
      feedback: {
        id: string;
        type: string;
        comment: string | null;
        createdAt: Date;
        revokesFeedbackId: string | null;
      }[];
    }[],
  ): Promise<Map<string, CuratedVersion>> {
    const chain = new Map<string, CuratedVersion>();

    const add = (row: (typeof insights)[number]) => {
      chain.set(row.id, {
        id: row.id,
        status: row.status,
        supersedesInsightId: row.supersedesInsightId,
        feedback: row.feedback,
        reconciliationOutcome: this.lastReconciliationOutcome(
          row.reasoningTrace,
        ),
      });
    };

    for (const insight of insights) add(insight);

    let pending = [
      ...new Set(
        insights
          .map((insight) => insight.supersedesInsightId)
          .filter((id): id is string => id !== null),
      ),
    ];

    for (let depth = 0; depth < MAX_CURATION_LOOKBACK && pending.length > 0;) {
      const rows = await this.prisma.insight.findMany({
        where: { id: { in: pending }, organizationId },
        select: {
          id: true,
          status: true,
          supersedesInsightId: true,
          reasoningTrace: true,
          feedback: {
            select: {
              id: true,
              type: true,
              comment: true,
              createdAt: true,
              revokesFeedbackId: true,
            },
          },
        },
      });
      if (rows.length === 0) break;

      for (const row of rows) add(row);
      depth += 1;

      pending = [
        ...new Set(
          rows
            .map((row) => row.supersedesInsightId)
            .filter((id): id is string => id !== null)
            .filter((id) => !chain.has(id)),
        ),
      ];
    }

    return chain;
  }

  /**
   * Resultado de la reconciliación que produjo esta versión, si la hubo.
   *
   * Lo escribe `TriggerAnalysisRun` al versionar. Se lee la ÚLTIMA entrada porque la traza
   * acumula el historial completo y lo que importa aquí es la transición que dio lugar a
   * esta versión concreta.
   */
  private lastReconciliationOutcome(raw: Prisma.JsonValue): string | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return null;
    }
    const reconciliations = (raw as Record<string, unknown>).reconciliations;
    if (!Array.isArray(reconciliations) || reconciliations.length === 0) {
      return null;
    }

    const last: unknown = reconciliations[reconciliations.length - 1];
    if (typeof last !== 'object' || last === null) return null;

    const outcome = (last as Record<string, unknown>).outcome;
    return typeof outcome === 'string' ? outcome : null;
  }

  private parseClosure(
    raw: Prisma.JsonValue,
  ): { kind: string; refId: string }[] {
    return Array.isArray(raw)
      ? (raw as unknown as { kind: string; refId: string }[])
      : [];
  }
}

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
import { InsightScopeService } from './insight-scope.service';
import { TERMINAL_INSIGHT_STATUSES } from '../domain/insight-status.classification';
import { TERMINAL_KNOWLEDGE_ITEM_STATUSES } from '../../knowledge-engine/domain/knowledge-item-status.classification';
import {
  applyInsightDecay,
  evaluateFreshness,
  type EvidenceState,
  type EvidenceFreshness,
} from '../domain/insight-freshness';

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
  /** Curación humana vigente, si la hay: tiene prioridad sobre el recálculo (§3.7). */
  curation: { type: string; comment: string | null; at: Date } | null;
  createdAt: Date;
}

@Injectable()
export class RetrieveInsightsUseCase {
  private readonly logger = new Logger(RetrieveInsightsUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly insightScope: InsightScopeService,
  ) {}

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

    const insights = await this.prisma.insight.findMany({
      where: {
        // Filtro de organización: primer filtro, sin excepción.
        organizationId: params.organizationId,
        // Exclusión OBLIGATORIA y no configurable de estados terminales (§12). Solo el
        // modo histórico explícito la omite, nunca por omisión.
        ...(params.historicalMode
          ? {}
          : {
              status: {
                notIn: [...TERMINAL_INSIGHT_STATUSES] as InsightStatus[],
              },
            }),
        ...(params.types ? { type: { in: params.types } } : {}),
        ...(params.insightIds ? { id: { in: params.insightIds } } : {}),
        ...(params.businessObjectiveId
          ? {
              objectiveLinks: {
                some: { businessObjectiveId: params.businessObjectiveId },
              },
            }
          : {}),
      },
      include: {
        evidence: true,
        objectiveLinks: { include: { businessObjective: true } },
        feedback: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (insights.length === 0) return [];

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

      // Curación humana: PRIORITARIA sobre cualquier recálculo automático (§3.7).
      const curation = this.resolveCuration(insight.feedback);

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

      // Alcance efectivo de colección (§3.4): un consumidor solo recupera un Insight si
      // cubre TODAS las colecciones que sostienen su justificación. Cobertura completa: el
      // acceso parcial deniega, nunca concede parcialmente.
      //
      // El alcance de organización completa se salta la comparación por diseño: lo usa el
      // razonamiento, que analiza todo el conocimiento de la empresa (§3.4).
      if (allowedCollectionIds !== null) {
        // Proyección ÚNICA del sistema (6.1): antes se calculaba aquí y otra vez en
        // `CurateInsight`. Dos definiciones del mismo alcance son dos criterios.
        const scope = await this.insightScope.effectiveScopeOf(
          params.organizationId,
          insight.transitiveEvidenceClosure,
        );
        const allowed = new Set(allowedCollectionIds);
        const covered = scope.every((collectionId) =>
          allowed.has(collectionId),
        );
        // Alcance vacío = evidencia sin colección o irresoluble: inaccesible por defecto.
        if (scope.length === 0 || !covered) continue;
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

    return results.slice(0, params.limit ?? 50);
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

  /** Curación vigente: la última entrada no revocada (§3.7). */
  private resolveCuration(
    feedback: {
      id: string;
      type: string;
      comment: string | null;
      createdAt: Date;
      revokesFeedbackId: string | null;
    }[],
  ): { type: string; comment: string | null; at: Date } | null {
    const revokedIds = new Set(
      feedback
        .map((f) => f.revokesFeedbackId)
        .filter((id): id is string => id !== null),
    );

    const current = feedback.find(
      (f) => f.type !== 'REVOCATION' && !revokedIds.has(f.id),
    );

    return current
      ? { type: current.type, comment: current.comment, at: current.createdAt }
      : null;
  }

  private parseClosure(
    raw: Prisma.JsonValue,
  ): { kind: string; refId: string }[] {
    return Array.isArray(raw)
      ? (raw as unknown as { kind: string; refId: string }[])
      : [];
  }
}

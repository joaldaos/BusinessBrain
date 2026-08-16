import { Injectable, NotFoundException } from '@nestjs/common';
import { KnowledgeItemStatus } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { CollectionAccessService } from '../../knowledge-engine/application/collection-access.service';
import { evaluateCollectionScopeCoverage } from '../domain/collection-scope-coverage';
import {
  buildBeliefTrajectory,
  type BeliefTransition,
  type BeliefVersionInput,
} from '../domain/belief-trajectory';
import { InsightScopeService } from './insight-scope.service';
import { pageBounds } from '../../common/dto/pagination.dto';

/**
 * Historia de una creencia — Fase 7.
 *
 * Responde "¿qué creíamos antes, qué creemos ahora y qué evidencia lo movió?" recorriendo la
 * cadena de supersesión de un asunto.
 *
 * ## Alcance aplicado VERSIÓN A VERSIÓN
 *
 * No basta con autorizar el `Insight` por el que se pregunta: cada versión de la cadena tiene
 * su propio `EffectiveCollectionScope`, porque su evidencia puede ser distinta. Una versión
 * cuyo alcance el lector no cubre **no aparece**. Autorizar una sola vez y devolver la cadena
 * entera sería una vía de fuga: bastaría con tener acceso a la versión actual para leer la
 * evidencia de todas las anteriores.
 *
 * ## Lo que no se hace
 *
 * - **No se recorre el grafo de evidencia** (§185): se comparan cierres planos ya
 *   materializados.
 * - **No se mezcla supersesión con evidencia** (§186): la trayectoria sigue un solo eje.
 * - **No se persiste ninguna frescura** (§166): aquí no se calcula ni se guarda.
 */

export interface BeliefHistoryVersion {
  id: string;
  confidence: number;
  status: string;
  createdAt: Date;
  analysisRunId: string;
  summary: string;
  evidenceCount: number;
}

export interface BeliefHistory {
  subjectIdentity: string;
  versions: BeliefHistoryVersion[];
  transitions: BeliefTransition[];
  /** Versiones de la cadena que el lector no puede ver. Recuento, nunca identificadores. */
  hiddenVersionCount: number;
}

@Injectable()
export class BeliefHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly insightScope: InsightScopeService,
    private readonly collectionAccess: CollectionAccessService,
  ) {}

  async forInsight(params: {
    organizationId: string;
    actorUserId: string;
    insightId: string;
    limit?: number;
    offset?: number;
  }): Promise<BeliefHistory> {
    // El punto de entrada debe existir en ESTA organización. Fuera del tenant no debe poder
    // distinguirse "no existe" de "no es tuyo".
    const entry = await this.prisma.insight.findFirst({
      where: { id: params.insightId, organizationId: params.organizationId },
      select: { subjectIdentity: true },
    });
    if (!entry) throw new NotFoundException('Insight no encontrado');

    const { take, skip } = pageBounds(params);

    // Toda la cadena del asunto, terminales incluidos: una historia sin las versiones
    // superadas no sería una historia. Aquí `SUPERSEDED` no es "excluir por defecto" como en
    // la lectura de comprensión viva (§12), sino exactamente lo que se está preguntando.
    const rows = await this.prisma.insight.findMany({
      where: {
        organizationId: params.organizationId,
        subjectIdentity: entry.subjectIdentity,
      },
      select: {
        id: true,
        supersedesInsightId: true,
        confidence: true,
        status: true,
        createdAt: true,
        analysisRunId: true,
        summary: true,
        transitiveEvidenceClosure: true,
        evidence: {
          select: {
            role: true,
            knowledgeItemId: true,
            knowledgeChunkId: true,
            derivedInsightId: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take,
      skip,
    });
    if (rows.length === 0) throw new NotFoundException('Insight no encontrado');

    const allowedCollectionIds =
      await this.collectionAccess.accessibleCollectionIds({
        organizationId: params.organizationId,
        userId: params.actorUserId,
      });

    const versions: BeliefVersionInput[] = rows.map((row) => ({
      id: row.id,
      supersedesInsightId: row.supersedesInsightId,
      confidence: row.confidence,
      status: row.status,
      createdAt: row.createdAt,
      analysisRunId: row.analysisRunId,
      transitiveEvidenceClosure: this.closureEntries(
        row.transitiveEvidenceClosure,
      ),
      contradictingRefIds: row.evidence
        .filter((piece) => piece.role === 'CONTRADICTION')
        .map(
          (piece) =>
            piece.knowledgeItemId ??
            piece.knowledgeChunkId ??
            piece.derivedInsightId ??
            '',
        )
        .filter((refId) => refId.length > 0),
    }));

    // Alcance de CADA versión, con la misma regla de cobertura completa del resto del
    // sistema. La proyección es la única del sistema (`InsightScopeService`).
    const visibleVersionIds = new Set<string>();
    for (const version of versions) {
      const scope = await this.insightScope.effectiveScopeOf(
        params.organizationId,
        version.transitiveEvidenceClosure,
      );
      const decision = evaluateCollectionScopeCoverage({
        effectiveCollectionScope: scope,
        allowedCollectionIds,
      });
      if (decision.allowed) visibleVersionIds.add(version.id);
    }

    const visibleRefIds = await this.visibleRefIds(
      params.organizationId,
      versions,
      allowedCollectionIds,
    );
    const supersededEvidenceRefIds = await this.supersededEvidence(
      params.organizationId,
      versions,
    );

    const trajectory = buildBeliefTrajectory({
      versions,
      visibleRefIds,
      visibleVersionIds,
      supersededEvidenceRefIds,
    });

    const byId = new Map(rows.map((row) => [row.id, row]));

    return {
      subjectIdentity: entry.subjectIdentity,
      versions: trajectory.versions.map((version) => {
        const row = byId.get(version.id)!;
        return {
          id: row.id,
          confidence: row.confidence,
          status: row.status,
          createdAt: row.createdAt,
          analysisRunId: row.analysisRunId,
          summary: row.summary,
          evidenceCount: version.transitiveEvidenceClosure.length,
        };
      }),
      transitions: trajectory.transitions,
      hiddenVersionCount: trajectory.hiddenVersionCount,
    };
  }

  /**
   * Referencias de evidencia que el lector puede ver.
   *
   * Defensa en profundidad: si una versión es visible, su cierre está por construcción
   * dentro del alcance. Aun así se filtra también aquí, porque la pertenencia a colección es
   * mutable y podría cambiar entre una comprobación y otra dentro de la misma petición.
   */
  private async visibleRefIds(
    organizationId: string,
    versions: BeliefVersionInput[],
    allowedCollectionIds: string[],
  ): Promise<Set<string>> {
    const refIds = [
      ...new Set(
        versions.flatMap((version) =>
          version.transitiveEvidenceClosure.map((ref) => ref.refId),
        ),
      ),
    ];
    if (refIds.length === 0 || allowedCollectionIds.length === 0) {
      return new Set();
    }

    const memberships = await this.prisma.knowledgeItemCollection.findMany({
      where: { knowledgeItem: { id: { in: refIds }, organizationId } },
      select: { knowledgeItemId: true, knowledgeCollectionId: true },
    });

    const allowed = new Set(allowedCollectionIds);
    const collectionsOf = new Map<string, string[]>();
    for (const membership of memberships) {
      const current = collectionsOf.get(membership.knowledgeItemId) ?? [];
      current.push(membership.knowledgeCollectionId);
      collectionsOf.set(membership.knowledgeItemId, current);
    }

    const visible = new Set<string>();
    for (const [refId, collections] of collectionsOf) {
      // Misma regla ALL: se ve si se cubren TODAS sus colecciones. Cubrir una parte no da
      // derecho a nombrarla.
      if (collections.every((collectionId) => allowed.has(collectionId))) {
        visible.add(refId);
      }
    }

    return visible;
  }

  /** Evidencia todavía presente cuya fuente de conocimiento fue versionada desde entonces. */
  private async supersededEvidence(
    organizationId: string,
    versions: BeliefVersionInput[],
  ): Promise<Set<string>> {
    const refIds = [
      ...new Set(
        versions.flatMap((version) =>
          version.transitiveEvidenceClosure.map((ref) => ref.refId),
        ),
      ),
    ];
    if (refIds.length === 0) return new Set();

    const items = await this.prisma.knowledgeItem.findMany({
      where: {
        id: { in: refIds },
        organizationId,
        status: KnowledgeItemStatus.SUPERSEDED,
      },
      select: { id: true },
    });

    return new Set(items.map((item) => item.id));
  }

  /**
   * Lee el cierre transitivo persistido como JSON.
   *
   * Se valida en lugar de castear: es un `Json` de Postgres escrito por versiones anteriores
   * del motor, y una entrada mal formada no debe convertirse en un `refId` inventado que
   * después se compare contra permisos.
   */
  private closureEntries(raw: unknown): { kind: string; refId: string }[] {
    if (!Array.isArray(raw)) return [];

    return (raw as unknown[]).flatMap((value) => {
      if (typeof value !== 'object' || value === null) return [];
      const entry = value as { kind?: unknown; refId?: unknown };
      if (typeof entry.refId !== 'string') return [];

      return [
        {
          kind: typeof entry.kind === 'string' ? entry.kind : 'KNOWLEDGE_ITEM',
          refId: entry.refId,
        },
      ];
    });
  }
}

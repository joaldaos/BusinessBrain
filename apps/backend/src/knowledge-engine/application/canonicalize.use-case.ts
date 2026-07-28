import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CanonicalCandidateOrigin,
  CanonicalResolutionStatus,
  KnowledgeItemStatus,
  Prisma,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import {
  getCanonicalWinnerMargin,
  resolveCanonicalGroup,
  type CanonicalCandidateInput,
} from '../domain/canonicalization';
import { TERMINAL_KNOWLEDGE_ITEM_STATUSES } from '../domain/knowledge-item-status.classification';

/**
 * Canonicalización — KNOWLEDGE_ENGINE_DESIGN.md §10, §3.10.
 *
 * Agrupa `KnowledgeItem` que describen el mismo hecho de negocio y resuelve cuál prevalece,
 * sin destruir los demás: un miembro no canónico permanece consultable pero excluido de
 * recuperación por defecto (§13, paso 4).
 *
 * Subfase 2.5: el mecanismo queda completo y operativo. Su alimentación AUTOMÁTICA desde el
 * nivel 3 de deduplicación (§7) no puede ejercitarse todavía porque depende de embeddings a
 * nivel de documento (subfase 2.6) — hasta entonces la vía de entrada real es el vínculo
 * manual ("estos dos documentos hablan de lo mismo", §10), que sí está operativo.
 */

const ACTIVE_STATUS_FILTER = {
  notIn: TERMINAL_KNOWLEDGE_ITEM_STATUSES as KnowledgeItemStatus[],
};

@Injectable()
export class CanonicalizeUseCase {
  private readonly logger = new Logger(CanonicalizeUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Vincula dos o más `KnowledgeItem` como candidatos del mismo hecho y resuelve el grupo.
   * Si alguno ya pertenece a un grupo, se reutiliza ese en vez de crear uno nuevo: un ítem
   * no puede estar en dos grupos canónicos que compitan por el mismo hecho.
   */
  async linkCandidates(params: {
    organizationId: string;
    knowledgeItemIds: string[];
    origin?: CanonicalCandidateOrigin;
    actorUserId?: string;
    now?: Date;
  }): Promise<string> {
    if (params.knowledgeItemIds.length < 2) {
      throw new Error(
        'La canonicalización exige al menos dos candidatos: agrupar uno solo no resuelve ningún conflicto',
      );
    }

    const items = await this.prisma.knowledgeItem.findMany({
      where: {
        id: { in: params.knowledgeItemIds },
        organizationId: params.organizationId,
      },
      select: {
        id: true,
        canonicalMemberships: { select: { canonicalKnowledgeEntityId: true } },
      },
    });

    if (items.length !== params.knowledgeItemIds.length) {
      throw new NotFoundException(
        'Alguno de los KnowledgeItem no existe o no pertenece a esta organización',
      );
    }

    const existingGroupIds = [
      ...new Set(
        items.flatMap((i) =>
          i.canonicalMemberships.map((m) => m.canonicalKnowledgeEntityId),
        ),
      ),
    ];

    if (existingGroupIds.length > 1) {
      // Fusionar grupos ya resueltos es una decisión de dominio que §10 no define: se
      // rechaza explícitamente en vez de elegir uno de forma arbitraria.
      throw new Error(
        'Los candidatos pertenecen a grupos canónicos distintos; fusionarlos requiere revisión humana explícita',
      );
    }

    const entityId =
      existingGroupIds[0] ??
      (
        await this.prisma.canonicalKnowledgeEntity.create({
          data: {
            organizationId: params.organizationId,
            status: CanonicalResolutionStatus.IN_CONFLICT,
          },
        })
      ).id;

    for (const itemId of params.knowledgeItemIds) {
      await this.prisma.canonicalCandidate.upsert({
        where: {
          canonicalKnowledgeEntityId_knowledgeItemId: {
            canonicalKnowledgeEntityId: entityId,
            knowledgeItemId: itemId,
          },
        },
        update: {},
        create: {
          canonicalKnowledgeEntityId: entityId,
          knowledgeItemId: itemId,
          origin: params.origin ?? CanonicalCandidateOrigin.MANUAL_LINK,
        },
      });
    }

    await this.resolve({
      organizationId: params.organizationId,
      canonicalKnowledgeEntityId: entityId,
      actorUserId: params.actorUserId,
      now: params.now,
    });

    return entityId;
  }

  /**
   * Resuelve un grupo aplicando las reglas de §10. Se invoca al añadir un candidato y
   * también cuando cambia la confianza de uno existente (§3.10, "se actualiza cada vez que
   * aparece un nuevo candidato o cambia la confianza de uno existente").
   */
  async resolve(params: {
    organizationId: string;
    canonicalKnowledgeEntityId: string;
    actorUserId?: string;
    now?: Date;
  }): Promise<CanonicalResolutionStatus> {
    const now = params.now ?? new Date();

    const entity = await this.prisma.canonicalKnowledgeEntity.findFirst({
      where: {
        id: params.canonicalKnowledgeEntityId,
        organizationId: params.organizationId,
      },
      include: {
        candidates: {
          include: {
            knowledgeItem: {
              select: {
                id: true,
                status: true,
                confidenceScore: true,
                indexedAt: true,
                createdAt: true,
                currentKnowledgeSource: { select: { type: true } },
              },
            },
          },
        },
      },
    });
    if (!entity)
      throw new NotFoundException('Canonical Knowledge Entity no encontrada');

    // Solo compiten los miembros activos: un ítem reemplazado o eliminado ya no representa
    // conocimiento vivo y no puede ser la versión oficial de nada.
    const activeCandidates: CanonicalCandidateInput[] = entity.candidates
      .filter(
        (c) =>
          !(TERMINAL_KNOWLEDGE_ITEM_STATUSES as KnowledgeItemStatus[]).includes(
            c.knowledgeItem.status,
          ),
      )
      .map((c) => ({
        knowledgeItemId: c.knowledgeItem.id,
        confidenceScore: c.knowledgeItem.confidenceScore ?? 0,
        sourceType: c.knowledgeItem.currentKnowledgeSource?.type ?? null,
        indexedAt: c.knowledgeItem.indexedAt ?? c.knowledgeItem.createdAt,
      }));

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: params.organizationId },
      select: { settings: true },
    });

    const resolution = resolveCanonicalGroup({
      candidates: activeCandidates,
      winnerMargin: getCanonicalWinnerMargin(organization.settings),
      now,
      currentWinnerId: entity.winnerKnowledgeItemId,
    });

    const status =
      resolution.status === 'RESOLVED'
        ? CanonicalResolutionStatus.RESOLVED
        : CanonicalResolutionStatus.IN_CONFLICT;

    const winnerChanged =
      entity.winnerKnowledgeItemId !== resolution.winnerKnowledgeItemId;
    const statusChanged = entity.status !== status;

    await this.prisma.$transaction([
      this.prisma.canonicalKnowledgeEntity.update({
        where: { id: entity.id },
        data: {
          status,
          winnerKnowledgeItemId: resolution.winnerKnowledgeItemId,
          winnerMargin: resolution.margin,
          resolvedAt:
            status === CanonicalResolutionStatus.RESOLVED ? now : null,
        },
      }),
      // El historial solo crece cuando algo cambia de verdad: reevaluar sin efecto no
      // debe llenar la auditoría de ruido.
      ...(winnerChanged || statusChanged
        ? [
            this.prisma.canonicalDecision.create({
              data: {
                canonicalKnowledgeEntityId: entity.id,
                previousWinnerId: entity.winnerKnowledgeItemId,
                newWinnerId: resolution.winnerKnowledgeItemId,
                status,
                rationale: {
                  reason: resolution.rationale,
                  margin: resolution.margin,
                  ranking: resolution.ranking,
                } as unknown as Prisma.InputJsonValue,
                actorUserId: params.actorUserId ?? null,
                createdAt: now,
              },
            }),
          ]
        : []),
    ]);

    if (status === CanonicalResolutionStatus.IN_CONFLICT) {
      this.logger.log(
        `Grupo canónico ${entity.id} en conflicto: ${resolution.rationale}`,
      );
    }

    return status;
  }

  /**
   * Cola de conflictos para revisión humana (§10): grupos que el sistema no resolvió porque
   * la diferencia era insuficiente. No se resuelven solos ni se ocultan.
   */
  async listConflicts(organizationId: string) {
    return this.prisma.canonicalKnowledgeEntity.findMany({
      where: { organizationId, status: CanonicalResolutionStatus.IN_CONFLICT },
      include: {
        candidates: {
          include: {
            knowledgeItem: {
              select: {
                id: true,
                title: true,
                confidenceScore: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Resolución manual de un conflicto por un usuario con permisos (§10): su decisión se
   * registra con autoría y cierra el conflicto.
   */
  async resolveManually(params: {
    organizationId: string;
    canonicalKnowledgeEntityId: string;
    winnerKnowledgeItemId: string;
    actorUserId: string;
  }): Promise<void> {
    const entity = await this.prisma.canonicalKnowledgeEntity.findFirst({
      where: {
        id: params.canonicalKnowledgeEntityId,
        organizationId: params.organizationId,
      },
      include: { candidates: { select: { knowledgeItemId: true } } },
    });
    if (!entity)
      throw new NotFoundException('Canonical Knowledge Entity no encontrada');

    const isMember = entity.candidates.some(
      (c) => c.knowledgeItemId === params.winnerKnowledgeItemId,
    );
    if (!isMember) {
      throw new Error(
        'El ganador designado no es candidato de este grupo canónico',
      );
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.canonicalKnowledgeEntity.update({
        where: { id: entity.id },
        data: {
          status: CanonicalResolutionStatus.RESOLVED,
          winnerKnowledgeItemId: params.winnerKnowledgeItemId,
          winnerMargin: null,
          resolvedAt: now,
        },
      }),
      this.prisma.canonicalDecision.create({
        data: {
          canonicalKnowledgeEntityId: entity.id,
          previousWinnerId: entity.winnerKnowledgeItemId,
          newWinnerId: params.winnerKnowledgeItemId,
          status: CanonicalResolutionStatus.RESOLVED,
          rationale: {
            reason: 'Resolución manual por revisión humana (§10)',
          },
          actorUserId: params.actorUserId,
          createdAt: now,
        },
      }),
    ]);
  }

  /**
   * Identificadores de los miembros NO canónicos de grupos ya resueltos. El Retriever los
   * excluye de recuperación por defecto (§13, paso 4) — se expone aquí para que ese filtro
   * no tenga que conocer el modelo interno de canonicalización.
   */
  async listNonCanonicalItemIds(organizationId: string): Promise<string[]> {
    const resolved = await this.prisma.canonicalKnowledgeEntity.findMany({
      where: {
        organizationId,
        status: CanonicalResolutionStatus.RESOLVED,
        winnerKnowledgeItemId: { not: null },
      },
      select: {
        winnerKnowledgeItemId: true,
        candidates: {
          where: { knowledgeItem: { status: ACTIVE_STATUS_FILTER } },
          select: { knowledgeItemId: true },
        },
      },
    });

    return resolved.flatMap((entity) =>
      entity.candidates
        .map((c) => c.knowledgeItemId)
        .filter((id) => id !== entity.winnerKnowledgeItemId),
    );
  }
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ConfidenceEventType,
  ConnectionStatus,
  KnowledgeItemStatus,
  Prisma,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import {
  applyTemporalDecay,
  getDecaySettings,
} from '../domain/confidence-decay';
import { TERMINAL_KNOWLEDGE_ITEM_STATUSES } from '../domain/knowledge-item-status.classification';

/**
 * Confianza viva — KNOWLEDGE_ENGINE_DESIGN.md §8.2, §8.3, §8.4.
 *
 * El score no se recalcula de forma continua: se dispara por EVENTOS concretos y por un
 * barrido periódico que aplica el decaimiento temporal. Cada cambio queda registrado con su
 * motivo — la confianza es auditable, no solo su valor actual sino su historia (§8.4).
 *
 * Regla transversal e innegociable: una FIJACIÓN MANUAL tiene prioridad sobre cualquier
 * recálculo automático hasta que se revoca explícitamente (§8.2). Ni el decaimiento ni un
 * evento de fuente desconectada la tocan.
 */

/** Ítems sobre los que opera el barrido: solo conocimiento vivo. */
const ACTIVE_STATUS_FILTER = {
  notIn: TERMINAL_KNOWLEDGE_ITEM_STATUSES as KnowledgeItemStatus[],
};

/** Tamaño de lote del barrido. A partir de ~1M de ítems (§16) esto es incremental por diseño. */
const DECAY_BATCH_SIZE = 500;

export interface DecaySweepResult {
  itemsEvaluated: number;
  itemsUpdated: number;
  itemsSkippedManual: number;
}

@Injectable()
export class ScoreConfidenceUseCase {
  private readonly logger = new Logger(ScoreConfidenceUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Barrido periódico de decaimiento temporal (§8.3, §8.4). Procesa por lotes: a volumen
   * alto no puede ejecutarse como un paso único (§16).
   *
   * Idempotente en el sentido que importa: aplicar el barrido dos veces seguidas sin que
   * pase el tiempo no degrada dos veces, porque el decaimiento se calcula siempre desde
   * `confidenceComputedAt`, no como un decremento acumulativo.
   */
  async runDecaySweep(params: {
    organizationId: string;
    now?: Date;
  }): Promise<DecaySweepResult> {
    const now = params.now ?? new Date();

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: params.organizationId },
      select: { settings: true },
    });
    const settings = getDecaySettings(organization.settings);

    const result: DecaySweepResult = {
      itemsEvaluated: 0,
      itemsUpdated: 0,
      itemsSkippedManual: 0,
    };

    let cursor: string | undefined;

    for (;;) {
      const batch = await this.prisma.knowledgeItem.findMany({
        where: {
          organizationId: params.organizationId,
          status: ACTIVE_STATUS_FILTER,
          confidenceScore: { not: null },
        },
        select: {
          id: true,
          businessArea: true,
          confidenceScore: true,
          confidenceComputedAt: true,
          confidenceIsManual: true,
          currentKnowledgeSource: { select: { status: true } },
        },
        orderBy: { id: 'asc' },
        take: DECAY_BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;

      for (const item of batch) {
        result.itemsEvaluated += 1;

        // Curación humana: pegajosa frente a cualquier recálculo automático (§8.2).
        if (item.confidenceIsManual) {
          result.itemsSkippedManual += 1;
          continue;
        }

        const sourceInactive =
          item.currentKnowledgeSource?.status === ConnectionStatus.ERROR ||
          item.currentKnowledgeSource?.status === ConnectionStatus.DISABLED;

        const decayed = applyTemporalDecay(
          {
            currentScore: item.confidenceScore!,
            computedAt: item.confidenceComputedAt ?? now,
            now,
            businessArea: item.businessArea,
            sourceInactive,
          },
          settings,
        );

        // Sin cambio apreciable no se escribe: evita ruido en el historial y escrituras
        // inútiles en cada pasada del barrido.
        if (Math.abs(decayed.score - item.confidenceScore!) < 0.0001) {
          continue;
        }

        await this.recordAndApply({
          organizationId: params.organizationId,
          knowledgeItemId: item.id,
          type: ConfidenceEventType.TEMPORAL_DECAY,
          previousScore: item.confidenceScore,
          newScore: decayed.score,
          detail: {
            halfLifeDays: decayed.halfLifeDays,
            elapsedDays: decayed.elapsedDays,
            floor: decayed.floor,
            sourceInactive,
            businessArea: item.businessArea,
          },
          computedAt: now,
        });
        result.itemsUpdated += 1;
      }

      if (batch.length < DECAY_BATCH_SIZE) break;
    }

    this.logger.log(
      `Barrido de decaimiento (org ${params.organizationId}): ${result.itemsEvaluated} evaluados, ` +
        `${result.itemsUpdated} actualizados, ${result.itemsSkippedManual} con fijación manual respetada`,
    );
    return result;
  }

  /**
   * Recálculo por evento: la `KnowledgeSource` de origen se desconectó (§8.2). No anula la
   * confianza — marca la señal para que el decaimiento la trate con más severidad, y deja
   * constancia del evento.
   */
  async onSourceDisconnected(params: {
    organizationId: string;
    knowledgeSourceId: string;
    now?: Date;
  }): Promise<number> {
    const now = params.now ?? new Date();
    const items = await this.prisma.knowledgeItem.findMany({
      where: {
        organizationId: params.organizationId,
        currentKnowledgeSourceId: params.knowledgeSourceId,
        status: ACTIVE_STATUS_FILTER,
        confidenceIsManual: false,
        confidenceScore: { not: null },
      },
      select: { id: true, confidenceScore: true },
    });

    for (const item of items) {
      await this.prisma.confidenceEvent.create({
        data: {
          organizationId: params.organizationId,
          knowledgeItemId: item.id,
          type: ConfidenceEventType.SOURCE_DISCONNECTED,
          previousScore: item.confidenceScore,
          // El score no cambia aquí: cambia la severidad con la que envejecerá.
          newScore: item.confidenceScore!,
          detail: {
            knowledgeSourceId: params.knowledgeSourceId,
            effect:
              'El decaimiento pasa a aplicarse con mayor severidad (§8.2)',
          },
          createdAt: now,
        },
      });
    }

    return items.length;
  }

  /**
   * Curación humana (§8.2): un usuario con permisos fija manualmente la confianza. A partir
   * de aquí ningún recálculo automático la sobrescribe hasta que se revoque.
   */
  async setManualConfidence(params: {
    organizationId: string;
    knowledgeItemId: string;
    score: number;
    actorUserId: string;
    reason?: string;
  }): Promise<void> {
    if (params.score < 0 || params.score > 1) {
      throw new Error(
        'La confianza fijada manualmente debe estar en el rango [0,1]',
      );
    }

    const item = await this.prisma.knowledgeItem.findFirst({
      where: {
        id: params.knowledgeItemId,
        organizationId: params.organizationId,
      },
      select: { id: true, confidenceScore: true },
    });
    if (!item) throw new NotFoundException('KnowledgeItem no encontrado');

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.knowledgeItem.update({
        where: { id: item.id },
        data: {
          confidenceScore: params.score,
          confidenceIsManual: true,
          confidenceManualById: params.actorUserId,
          confidenceManualAt: now,
          confidenceComputedAt: now,
        },
      }),
      this.prisma.confidenceEvent.create({
        data: {
          organizationId: params.organizationId,
          knowledgeItemId: item.id,
          type: ConfidenceEventType.MANUAL_OVERRIDE,
          previousScore: item.confidenceScore,
          newScore: params.score,
          detail: { reason: params.reason ?? null },
          actorUserId: params.actorUserId,
          createdAt: now,
        },
      }),
    ]);
  }

  /**
   * Revoca una fijación manual: el ítem vuelve al cálculo automático y volverá a decaer.
   * No borra el evento anterior — el historial nunca se reescribe (§8.4).
   */
  async revokeManualConfidence(params: {
    organizationId: string;
    knowledgeItemId: string;
    actorUserId: string;
  }): Promise<void> {
    const item = await this.prisma.knowledgeItem.findFirst({
      where: {
        id: params.knowledgeItemId,
        organizationId: params.organizationId,
        confidenceIsManual: true,
      },
      select: { id: true, confidenceScore: true },
    });
    if (!item) {
      throw new NotFoundException(
        'KnowledgeItem no encontrado o sin fijación manual activa',
      );
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.knowledgeItem.update({
        where: { id: item.id },
        data: {
          confidenceIsManual: false,
          confidenceManualById: null,
          confidenceManualAt: null,
          // El reloj del decaimiento arranca ahora: no se castiga retroactivamente el
          // periodo en el que la confianza estuvo legítimamente fijada por una persona.
          confidenceComputedAt: now,
        },
      }),
      this.prisma.confidenceEvent.create({
        data: {
          organizationId: params.organizationId,
          knowledgeItemId: item.id,
          type: ConfidenceEventType.MANUAL_REVOKED,
          previousScore: item.confidenceScore,
          newScore: item.confidenceScore!,
          detail: { effect: 'Vuelve al cálculo automático' },
          actorUserId: params.actorUserId,
          createdAt: now,
        },
      }),
    ]);
  }

  private async recordAndApply(params: {
    organizationId: string;
    knowledgeItemId: string;
    type: ConfidenceEventType;
    previousScore: number | null;
    newScore: number;
    detail: Prisma.InputJsonValue;
    computedAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.knowledgeItem.update({
        where: { id: params.knowledgeItemId },
        data: {
          confidenceScore: params.newScore,
          confidenceComputedAt: params.computedAt,
        },
      }),
      this.prisma.confidenceEvent.create({
        data: {
          organizationId: params.organizationId,
          knowledgeItemId: params.knowledgeItemId,
          type: params.type,
          previousScore: params.previousScore,
          newScore: params.newScore,
          detail: params.detail,
          createdAt: params.computedAt,
        },
      }),
    ]);
  }
}

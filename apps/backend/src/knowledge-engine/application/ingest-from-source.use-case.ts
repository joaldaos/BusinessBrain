import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ConnectionStatus,
  IngestionTriggerType,
  KnowledgeItemStatus,
  RunStatus,
  type Prisma,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectorRegistry } from '../infrastructure/connectors/connector-registry.service';
import { normalizeContent } from './normalize-content.use-case';

export interface IngestionStats {
  itemsFound: number;
  itemsCreated: number;
  itemsFailed: number;
}

export interface IngestFromSourceParams {
  organizationId: string;
  knowledgeSourceId: string;
  connectorInput: unknown;
  triggerType?: IngestionTriggerType;
}

export interface IngestFromSourceResult {
  ingestionJobId: string;
  status: RunStatus;
  stats: IngestionStats;
  knowledgeItemIds: string[];
}

/**
 * Orquesta un ciclo de ingesta completo para la subfase 2.1 (KNOWLEDGE_ENGINE_DESIGN.md §4:
 * Connector → IngestionJob → Normalización → KnowledgeItem candidato). Deduplicación,
 * versionado, clasificación, confianza, canonicalización, chunking y embeddings son
 * responsabilidad de subfases posteriores (§19) — por eso el KnowledgeItem creado aquí queda
 * en estado PROCESSING, no INDEXED: el pipeline completo (§3.5, "ciclo de vida") todavía no ha
 * corrido sobre él.
 */
@Injectable()
export class IngestFromSourceUseCase {
  private readonly logger = new Logger(IngestFromSourceUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorRegistry: ConnectorRegistry,
  ) {}

  async execute(
    params: IngestFromSourceParams,
  ): Promise<IngestFromSourceResult> {
    const knowledgeSource = await this.prisma.knowledgeSource.findFirst({
      where: {
        id: params.knowledgeSourceId,
        organizationId: params.organizationId,
      },
    });
    if (!knowledgeSource) {
      throw new NotFoundException('KnowledgeSource no encontrada');
    }

    const job = await this.prisma.ingestionJob.create({
      data: {
        knowledgeSourceId: knowledgeSource.id,
        organizationId: params.organizationId,
        triggerType: params.triggerType ?? IngestionTriggerType.MANUAL,
        status: RunStatus.RUNNING,
      },
    });
    await this.prisma.knowledgeSource.update({
      where: { id: knowledgeSource.id },
      data: { status: ConnectionStatus.SYNCING },
    });

    try {
      const connector = this.connectorRegistry.get(
        knowledgeSource.connectorKey,
      );
      const extracted = await connector.extract(params.connectorInput);

      const stats: IngestionStats = {
        itemsFound: extracted.length,
        itemsCreated: 0,
        itemsFailed: 0,
      };
      const knowledgeItemIds: string[] = [];
      const itemErrors: string[] = [];

      for (const candidate of extracted) {
        try {
          const normalized = normalizeContent(
            candidate.rawContent,
            candidate.mimeType,
          );
          const item = await this.prisma.knowledgeItem.create({
            data: {
              organizationId: params.organizationId,
              originKnowledgeSourceId: knowledgeSource.id,
              originIngestionJobId: job.id,
              currentKnowledgeSourceId: knowledgeSource.id,
              title: candidate.title,
              sourceUrl: candidate.sourceUrl,
              mimeType: candidate.mimeType,
              sizeBytes: candidate.sizeBytes,
              contentText: normalized.text,
              contentHash: normalized.contentHash,
              status: KnowledgeItemStatus.PROCESSING,
            },
          });
          knowledgeItemIds.push(item.id);
          stats.itemsCreated += 1;
        } catch (error) {
          stats.itemsFailed += 1;
          const message =
            error instanceof Error ? error.message : String(error);
          itemErrors.push(`"${candidate.title}": ${message}`);
          this.logger.warn(
            `Fallo al normalizar/crear KnowledgeItem de "${candidate.title}": ${message}`,
          );
        }
      }

      const status =
        stats.itemsCreated > 0 ? RunStatus.SUCCESS : RunStatus.FAILED;
      const jobError = itemErrors.length > 0 ? itemErrors.join('; ') : null;

      await this.prisma.ingestionJob.update({
        where: { id: job.id },
        data: {
          status,
          stats: stats as unknown as Prisma.InputJsonValue,
          error: jobError,
          finishedAt: new Date(),
        },
      });
      await this.prisma.knowledgeSource.update({
        where: { id: knowledgeSource.id },
        data:
          status === RunStatus.SUCCESS
            ? {
                status: ConnectionStatus.CONNECTED,
                lastSyncedAt: new Date(),
                lastError: null,
              }
            : { status: ConnectionStatus.ERROR, lastError: jobError },
      });

      return { ingestionJobId: job.id, status, stats, knowledgeItemIds };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.ingestionJob.update({
        where: { id: job.id },
        data: {
          status: RunStatus.FAILED,
          error: message,
          finishedAt: new Date(),
        },
      });
      await this.prisma.knowledgeSource.update({
        where: { id: knowledgeSource.id },
        data: { status: ConnectionStatus.ERROR, lastError: message },
      });
      throw error;
    }
  }
}

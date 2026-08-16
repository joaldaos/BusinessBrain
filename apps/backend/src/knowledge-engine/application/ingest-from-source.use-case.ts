import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ClassificationSource,
  ConfidenceEventType,
  ConnectionStatus,
  IngestionTriggerType,
  KnowledgeItemStatus,
  Prisma,
  RunStatus,
  type KnowledgeItem,
  type KnowledgeSourceType,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/utils/encryption.util';
import { ConnectorRegistry } from '../infrastructure/connectors/connector-registry.service';
import { ClassifyContentUseCase } from './classify-content.use-case';
import { computeInitialConfidence } from '../domain/confidence';
import {
  normalizeContent,
  type NormalizedContent,
} from './normalize-content.use-case';
import {
  computeShingles,
  jaccardSimilarity,
} from './structural-similarity.use-case';
import { getStructuralSimilarityThreshold } from '../domain/deduplication-config';
import { TERMINAL_KNOWLEDGE_ITEM_STATUSES } from '../domain/knowledge-item-status.classification';
import {
  NoopSemanticDeduplication,
  type SemanticDeduplicationPort,
} from '../domain/ports/semantic-deduplication.port';
import type { ExtractedContent } from '../domain/ports/connector.port';

export interface IngestionStats {
  itemsFound: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsSkippedDuplicate: number;
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

type IngestOutcome =
  | { type: 'created'; knowledgeItemId: string }
  | { type: 'updated'; knowledgeItemId: string }
  | { type: 'duplicate'; knowledgeItemId: string };

const ACTIVE_STATUS_FILTER = {
  notIn: TERMINAL_KNOWLEDGE_ITEM_STATUSES as KnowledgeItemStatus[],
};

/**
 * Orquesta un ciclo de ingesta completo (KNOWLEDGE_ENGINE_DESIGN.md §4: Connector → IngestionJob
 * → Normalización → Deduplicación/Versionado → KnowledgeItem). Subfase 2.2: implementa con
 * lógica real los niveles 1 (hash exacto) y 2 (similitud estructural) de deduplicación (§7) y el
 * grafo de linaje (§3.7, §6) para el escenario de actualización automática (arista `UPDATES`). El
 * nivel 3 se invoca como puerto preparado, sin producir candidatos todavía (hallazgo C de la
 * Revisión formal — Subfase 2.2). Subfase 2.3: clasificación automática contra la taxonomía de
 * la organización (§9) y cálculo inicial del confidence score (§8.1), ambos sobre contenido ya
 * deduplicado (§4, paso 5) — con ellos el KnowledgeItem alcanza INDEXED. Canonicalización,
 * chunking y embeddings siguen sin implementar (subfases 2.5-2.6).
 */
@Injectable()
export class IngestFromSourceUseCase {
  private readonly logger = new Logger(IngestFromSourceUseCase.name);
  // Campo de clase, no parámetro de constructor: SemanticDeduplicationPort es una interfaz TS,
  // sin representación en tiempo de ejecución — NestJS no puede resolverla por tipo. Evita
  // depender de un token de inyección para una única implementación no-operativa (hallazgo C).
  private readonly semanticDeduplication: SemanticDeduplicationPort =
    new NoopSemanticDeduplication();

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorRegistry: ConnectorRegistry,
    private readonly classifyContent: ClassifyContentUseCase,
    private readonly encryption: EncryptionService,
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

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: params.organizationId },
      select: { settings: true },
    });
    const structuralSimilarityThreshold = getStructuralSimilarityThreshold(
      organization.settings,
    );

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
      // Al conector se le entrega SU config, ya descifrada. Un conector que TRAE contenido
      // (`PULL`) no recibe nada en la petición: todo lo que necesita para ir a buscarlo —una
      // dirección, mañana una carpeta o un buzón— está declarado en la fuente, que es lo que
      // KNOWLEDGE_ENGINE_DESIGN.md §3.2 llama su alcance.
      //
      // El descifrado ocurre aquí y no en la superficie a propósito: la config puede contener
      // secretos, y no debe pasar por un controlador ni asomarse a una respuesta HTTP.
      // Marcador de la última sincronización: lo devuelve el conector y se guarda al terminar
      // BIEN. Guardarlo antes haría que una ejecución fallida avanzara el marcador y se
      // perdieran para siempre los cambios de esa ventana.
      let nextCursor: string | null = null;
      const removedAtSource: string[] = [];

      const extracted = await connector.extract({
        ...(params.connectorInput as Record<string, unknown> | undefined),
        organizationId: params.organizationId,
        config: this.readConfig(knowledgeSource.configEnc),
        cursor:
          typeof knowledgeSource.syncCursor === 'string'
            ? knowledgeSource.syncCursor
            : undefined,
        onCursor: (cursor: string) => {
          nextCursor = cursor;
        },
        onRemoved: (fileIds: string[]) => {
          removedAtSource.push(...fileIds);
        },
      });

      const stats: IngestionStats = {
        itemsFound: extracted.length,
        itemsCreated: 0,
        itemsUpdated: 0,
        itemsSkippedDuplicate: 0,
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

          // Nivel 3 (§7): puerto invocable, sin candidatos reales todavía (hallazgo C) — no
          // afecta al resultado, se llama para que la capacidad quede genuinamente presente en
          // el pipeline, no solo declarada como archivo sin uso.
          await this.semanticDeduplication.findCandidates({
            organizationId: params.organizationId,
            contentText: normalized.text,
            excludeKnowledgeSourceId: knowledgeSource.id,
          });

          const outcome = await this.resolveAndPersist({
            organizationId: params.organizationId,
            knowledgeSource,
            job,
            candidate,
            normalized,
            structuralSimilarityThreshold,
          });

          // Clasificación y confianza se calculan sobre contenido YA deduplicado (§4,
          // paso 5): no se gasta cómputo clasificando duplicados que se descartan.
          if (outcome.type === 'created' || outcome.type === 'updated') {
            await this.classifyAndScore({
              organizationId: params.organizationId,
              knowledgeItemId: outcome.knowledgeItemId,
              title: candidate.title,
              contentText: normalized.text,
              sourceType: knowledgeSource.type,
            });
          }

          knowledgeItemIds.push(outcome.knowledgeItemId);
          if (outcome.type === 'created') stats.itemsCreated += 1;
          else if (outcome.type === 'updated') stats.itemsUpdated += 1;
          else stats.itemsSkippedDuplicate += 1;
        } catch (error) {
          stats.itemsFailed += 1;
          const message =
            error instanceof Error ? error.message : String(error);
          itemErrors.push(`"${candidate.title}": ${message}`);
          this.logger.warn(
            `Fallo al procesar KnowledgeItem de "${candidate.title}": ${message}`,
          );
        }
      }

      const anySucceeded =
        stats.itemsCreated + stats.itemsUpdated + stats.itemsSkippedDuplicate >
        0;
      const status = anySucceeded ? RunStatus.SUCCESS : RunStatus.FAILED;
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
      if (removedAtSource.length > 0) {
        // Se INFORMA de lo que ya no está en el origen, y no se toca nada más.
        //
        // Qué debe ocurrir con un documento que desaparece de su fuente es una decisión de
        // producto que el diseño congelado no resuelve: §5 y §6 definen qué SIGNIFICA el
        // estado ELIMINADO y cómo se restaura, pero no dicen si una sincronización debe
        // aplicarlo por su cuenta. Y la diferencia importa: sacar un fichero de la carpeta
        // vigilada es indistinguible de borrarlo, así que aplicarlo automáticamente
        // retiraría conocimiento que la empresa sigue usando. Pendiente de decisión.
        this.logger.warn(
          `${removedAtSource.length} documento(s) ya no están en el origen de la fuente ` +
            `${knowledgeSource.id}. No se modifica su estado: la política de supresión está ` +
            `pendiente de una decisión de producto`,
        );
      }

      await this.prisma.knowledgeSource.update({
        where: { id: knowledgeSource.id },
        data:
          status === RunStatus.SUCCESS
            ? {
                status: ConnectionStatus.CONNECTED,
                lastSyncedAt: new Date(),
                lastError: null,
                // El marcador avanza SOLO si la ejecución fue bien. Avanzarlo tras un fallo
                // perdería para siempre los cambios de esa ventana: la siguiente
                // sincronización preguntaría por lo posterior a algo que nunca se ingirió.
                ...(nextCursor !== null ? { syncCursor: nextCursor } : {}),
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

  /**
   * Decide el resultado de deduplicación (nivel 1 → nivel 2 → contenido nuevo) y lo persiste
   * como una única unidad atómica (KNOWLEDGE_ENGINE_DESIGN.md §7, "Especificación de
   * idempotencia bajo concurrencia"). La comprobación de nivel 1 (lectura) más la escritura no
   * son, por sí solas, seguras ante una carrera; la restricción de unicidad parcial a nivel de
   * base de datos (`KnowledgeItem_org_contentHash_active_key`) es el backstop real — ver el catch
   * de más abajo.
   */
  private async resolveAndPersist(params: {
    organizationId: string;
    knowledgeSource: { id: string };
    job: { id: string };
    candidate: ExtractedContent;
    normalized: NormalizedContent;
    structuralSimilarityThreshold: number;
  }): Promise<IngestOutcome> {
    const {
      organizationId,
      knowledgeSource,
      job,
      candidate,
      normalized,
      structuralSimilarityThreshold,
    } = params;

    const newItemData = {
      organizationId,
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
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Nivel 1 (§7): hash exacto dentro de la organización, solo contra ítems activos.
        const exactDuplicate = await tx.knowledgeItem.findFirst({
          where: {
            organizationId,
            contentHash: normalized.contentHash,
            status: ACTIVE_STATUS_FILTER,
          },
        });
        if (exactDuplicate) {
          return {
            type: 'duplicate' as const,
            knowledgeItemId: exactDuplicate.id,
          };
        }

        // Nivel 2 (§7): candidatos "mismo título, mismo origen" dentro de la misma
        // KnowledgeSource actual; confirmación por similitud estructural (shingling + Jaccard).
        const structuralCandidates = await tx.knowledgeItem.findMany({
          where: {
            organizationId,
            currentKnowledgeSourceId: knowledgeSource.id,
            title: candidate.title,
            status: ACTIVE_STATUS_FILTER,
          },
        });

        const newShingles = computeShingles(normalized.text);
        let bestMatch: KnowledgeItem | null = null;
        let bestScore = 0;
        for (const existing of structuralCandidates) {
          const score = jaccardSimilarity(
            newShingles,
            computeShingles(existing.contentText),
          );
          if (score > bestScore) {
            bestScore = score;
            bestMatch = existing;
          }
        }

        if (bestMatch && bestScore >= structuralSimilarityThreshold) {
          // Bloqueo de fila sobre el predecesor: serializa dos actualizaciones concurrentes del
          // mismo documento para que nunca se generen dos aristas UPDATES sobre el mismo origen
          // (KNOWLEDGE_ENGINE_DESIGN.md §6, "Reglas transversales").
          const locked = await tx.$queryRaw<
            { id: string; status: KnowledgeItemStatus }[]
          >(
            Prisma.sql`SELECT "id", "status" FROM "KnowledgeItem" WHERE "id" = ${bestMatch.id} FOR UPDATE`,
          );
          const predecessor = locked[0];
          const predecessorStillActive =
            predecessor &&
            !(
              TERMINAL_KNOWLEDGE_ITEM_STATUSES as KnowledgeItemStatus[]
            ).includes(predecessor.status);

          if (predecessorStillActive) {
            const newItem = await tx.knowledgeItem.create({
              data: newItemData,
            });
            // Aquí NO se colocan las colecciones de la fuente: una versión nueva HEREDA las
            // de su predecesor (más abajo). Colocarlas dos veces violaría la unicidad, y
            // sustituirlas movería un documento de sitio por el mero hecho de actualizarse.

            await tx.knowledgeItemLineageEdge.create({
              data: {
                organizationId,
                fromKnowledgeItemId: newItem.id,
                toKnowledgeItemId: predecessor.id,
                type: 'UPDATES',
              },
            });

            await tx.knowledgeItem.update({
              where: { id: predecessor.id },
              data: { status: KnowledgeItemStatus.SUPERSEDED },
            });

            // Herencia de colecciones del anterior (§6), salvo indicación contraria — ninguna
            // se da todavía en esta subfase.
            const inheritedCollections =
              await tx.knowledgeItemCollection.findMany({
                where: { knowledgeItemId: predecessor.id },
              });
            if (inheritedCollections.length > 0) {
              await tx.knowledgeItemCollection.createMany({
                data: inheritedCollections.map((membership) => ({
                  knowledgeItemId: newItem.id,
                  knowledgeCollectionId: membership.knowledgeCollectionId,
                  organizationId,
                })),
              });
            }

            return { type: 'updated' as const, knowledgeItemId: newItem.id };
          }
          // El predecesor dejó de estar activo entre la lectura y el bloqueo (otra transacción
          // concurrente ya lo reemplazó) — se trata como contenido nuevo, no como actualización
          // de un predecesor que ya no es la cabeza de la cadena de versiones.
        }

        const newItem = await tx.knowledgeItem.create({ data: newItemData });
        await this.placeInSourceCollections(
          tx,
          organizationId,
          knowledgeSource.id,
          newItem.id,
        );
        return { type: 'created' as const, knowledgeItemId: newItem.id };
      });
    } catch (error) {
      if (this.isContentHashUniqueViolation(error)) {
        // Carrera de nivel 1: otra ingesta concurrente del mismo contenido ganó la creación
        // mientras esta transacción decidía (KNOWLEDGE_ENGINE_DESIGN.md §7, "Especificación de
        // idempotencia bajo concurrencia"). Se relee fuera de la transacción abortada y se trata
        // como duplicado exacto — mismo resultado que si hubiera llegado después en el tiempo.
        const winner = await this.prisma.knowledgeItem.findFirst({
          where: {
            organizationId,
            contentHash: normalized.contentHash,
            status: ACTIVE_STATUS_FILTER,
          },
        });
        if (winner) {
          return { type: 'duplicate' as const, knowledgeItemId: winner.id };
        }
      }
      throw error;
    }
  }

  /**
   * Clasifica el contenido, calcula su confianza inicial y deja el ítem INDEXADO —
   * KNOWLEDGE_ENGINE_DESIGN.md §9, §8.1, subfase 2.3.
   *
   * La certeza que reporta la clasificación es insumo directo del score (§8.1), por eso el
   * orden importa: primero clasificar, después puntuar.
   *
   * Un `KnowledgeItem` corregido manualmente NO se reclasifica: una corrección manual es
   * pegajosa y un reprocesamiento automático posterior no la sobrescribe salvo confirmación
   * explícita del usuario (§9, "Asignación").
   */
  private async classifyAndScore(params: {
    organizationId: string;
    knowledgeItemId: string;
    title: string;
    contentText: string;
    sourceType: KnowledgeSourceType;
  }): Promise<void> {
    const existing = await this.prisma.knowledgeItem.findUnique({
      where: { id: params.knowledgeItemId },
      select: { classificationSource: true },
    });

    const keepManual =
      existing?.classificationSource === ClassificationSource.MANUAL;

    const classification = keepManual
      ? null
      : await this.classifyContent.execute({
          organizationId: params.organizationId,
          title: params.title,
          contentText: params.contentText,
        });

    const confidence = computeInitialConfidence({
      sourceType: params.sourceType,
      classificationCertainty: classification?.certainty ?? null,
      contentText: params.contentText,
      title: params.title,
    });

    await this.prisma.confidenceEvent.create({
      data: {
        organizationId: params.organizationId,
        knowledgeItemId: params.knowledgeItemId,
        type: ConfidenceEventType.INITIAL,
        previousScore: null,
        newScore: confidence.score,
        detail: confidence.factors as unknown as Prisma.InputJsonValue,
      },
    });

    await this.prisma.knowledgeItem.update({
      where: { id: params.knowledgeItemId },
      data: {
        ...(classification
          ? {
              taxonomyNodeId: classification.taxonomyNodeId,
              businessArea: classification.businessArea,
              tags: classification.tags,
              classificationCertainty: classification.certainty,
              classificationSource: ClassificationSource.AUTOMATIC,
              classifiedAt: new Date(),
            }
          : {}),
        confidenceScore: confidence.score,
        confidenceFactors:
          confidence.factors as unknown as Prisma.InputJsonValue,
        confidenceComputedAt: new Date(),
        // El ítem queda recuperable: ya tiene clasificación y confianza. Chunking y
        // embeddings (2.6) operan sobre ítems ya indexados y no bloquean este estado.
        status: KnowledgeItemStatus.INDEXED,
        indexedAt: new Date(),
      },
    });
  }

  /**
   * Dentro de `resolveAndPersist`, la única restricción única que puede violar la creación de un
   * KnowledgeItem es `KnowledgeItem_org_contentHash_active_key` (nivel 1) — el `id` es un cuid
   * generado, sin colisión posible. Por eso basta con reconocer el código de error de Prisma
   * (P2002) en este contexto, sin depender de que Prisma pueda mapear el nombre de un índice
   * parcial creado por SQL manual (no declarado en schema.prisma) a un campo conocido.
   */
  private isContentHashUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  /**
   * Coloca el item recien creado en las colecciones que declara su fuente.
   *
   * Es lo que hace que el conocimiento sea VISIBLE: sin pertenencia a coleccion, su alcance
   * efectivo es vacio y la regla fail-closed lo esconde de todo el mundo, incluida la
   * comprension que se derive de el.
   *
   * Dentro de la misma transaccion que la creacion: un item a medio colocar seria un item
   * invisible sin que nada lo delatara.
   */
  private async placeInSourceCollections(
    tx: Prisma.TransactionClient,
    organizationId: string,
    knowledgeSourceId: string,
    knowledgeItemId: string,
  ): Promise<void> {
    const collections = await tx.knowledgeSourceCollection.findMany({
      where: { knowledgeSourceId, organizationId },
      select: { knowledgeCollectionId: true },
    });

    for (const { knowledgeCollectionId } of collections) {
      await tx.knowledgeItemCollection.create({
        data: { organizationId, knowledgeItemId, knowledgeCollectionId },
      });
    }
  }

  /**
   * Config de la fuente, descifrada.
   *
   * Una config ilegible NO tumba la ingesta con un error de cifrado: se entrega vacía y es el
   * conector quien dice qué le falta, en su idioma. `configEnc` puede venir de una fuente
   * antigua o de una clave rotada, y "no se pudo descifrar" no le dice nada a nadie.
   */
  private readConfig(configEnc: string): Record<string, unknown> {
    if (!configEnc) return {};
    try {
      const parsed: unknown = JSON.parse(this.encryption.decrypt(configEnc));
      return typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch (error) {
      this.logger.warn(
        `No se pudo leer la configuracion de la fuente: ${(error as Error).message}`,
      );
      return {};
    }
  }
}

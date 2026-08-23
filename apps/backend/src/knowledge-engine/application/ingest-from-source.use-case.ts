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
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import { ConnectorRegistry } from '../infrastructure/connectors/connector-registry.service';
import { RestrictedPerimeterService } from './restricted-perimeter.service';
import { ClassifyContentUseCase } from './classify-content.use-case';
import { ChunkAndEmbedUseCase } from './chunk-and-embed.use-case';
import { OperationalAlertsService } from '../../alerts/application/operational-alerts.service';
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
  /**
   * Ítems que entraron pero NO se pudieron vectorizar.
   *
   * Se cuenta aparte de `itemsFailed` porque no es lo mismo: el documento está aquí, entero,
   * clasificado y consultable en la lista. Lo que no está es su representación vectorial, y sin
   * ella **no aparece cuando alguien pregunta**. Un contador propio es lo que permite que la
   * pantalla lo diga en vez de dejar a la persona creyendo que el documento se ignoró.
   */
  itemsNotRetrievable: number;
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
    private readonly audit: AuditService,
    private readonly perimeter: RestrictedPerimeterService,
    private readonly chunkAndEmbed: ChunkAndEmbedUseCase,
    private readonly alerts: OperationalAlertsService,
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

    // El perímetro se vuelve a exigir AQUÍ, y no solo al crear la fuente: las concesiones
    // cambian después, y basta con que alguien abra esa colección a toda la organización para
    // que el perímetro desaparezca sin que nadie haya tocado la fuente. Antes de traer nada:
    // si el perímetro ya no existe, no se lee ni un mensaje.
    await this.perimeter.assertPerimeterFor({
      organizationId: params.organizationId,
      connectorKey: knowledgeSource.connectorKey,
      collectionIds: await this.perimeter.collectionIdsOf({
        organizationId: params.organizationId,
        knowledgeSourceId: knowledgeSource.id,
      }),
    });

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
      let presentAtSource: string[] | null = null;

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
        onPresentAtSource: (sourceUrls: string[]) => {
          presentAtSource = sourceUrls;
        },
      });

      const stats: IngestionStats = {
        itemsFound: extracted.length,
        itemsCreated: 0,
        itemsUpdated: 0,
        itemsSkippedDuplicate: 0,
        itemsFailed: 0,
        itemsNotRetrievable: 0,
      };
      const knowledgeItemIds: string[] = [];
      const itemErrors: string[] = [];

      for (const candidate of extracted) {
        try {
          // El título de un fichero subido es su nombre, y hace falta para reconocer el
          // formato real: el tipo declarado lo pone el navegador a partir de la extensión.
          const normalized = await normalizeContent(
            candidate.rawContent,
            candidate.mimeType,
            candidate.title,
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

            // Y se hace RECUPERABLE. Sin esto el documento existe, se lista y se clasifica,
            // pero no aparece cuando alguien pregunta: la recuperación es vectorial, sobre
            // `KnowledgeChunk`. Es el paso que convierte "lo tengo guardado" en "puedo
            // preguntarlo", y por tanto lo que hace útil todo lo anterior.
            if (!(await this.makeRetrievable(params.organizationId, outcome))) {
              stats.itemsNotRetrievable += 1;
            }
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

      // Una sincronización que no trae nada NO es un fallo.
      //
      // Con ingesta incremental, "sin cambios" es el caso NORMAL: la mayoría de las noches
      // no se toca ningún documento. Tratarlo como fallo dejaría cada fuente en ERROR cada
      // madrugada y acabaría deteniendo la automatización que la sincroniza. Solo hay fallo
      // cuando había candidatos y NINGUNO pudo procesarse.
      const anySucceeded =
        stats.itemsCreated + stats.itemsUpdated + stats.itemsSkippedDuplicate >
        0;
      const status =
        stats.itemsFound === 0 || anySucceeded
          ? RunStatus.SUCCESS
          : RunStatus.FAILED;
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
      if (status === RunStatus.SUCCESS && presentAtSource !== null) {
        await this.reconcileSourcePresence({
          organizationId: params.organizationId,
          knowledgeSourceId: knowledgeSource.id,
          presentSourceUrls: presentAtSource,
        });
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

      // Una fuente que se queda en rojo por la noche no se la mira nadie hasta que el cliente
      // pregunta algo y no obtiene respuesta. El aviso se emite DESPUÉS de persistir el
      // resultado y no puede alterarlo: se traga sus propios errores.
      if (status === RunStatus.FAILED) {
        await this.alerts.syncFailed({
          organizationId: params.organizationId,
          knowledgeSourceId: knowledgeSource.id,
          detail:
            jobError ?? 'La sincronización terminó sin poder procesar nada.',
        });
      }

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

      // El fallo se propaga —quien llamó tiene que enterarse— pero antes queda avisado.
      await this.alerts.syncFailed({
        organizationId: params.organizationId,
        knowledgeSourceId: knowledgeSource.id,
        detail: message,
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
      // Metadata OPERATIVA, fuera del contenido indexado. Ver `ExtractedContent`.
      ...(candidate.sourceMetadata
        ? { sourceMetadata: candidate.sourceMetadata as Prisma.InputJsonValue }
        : {}),
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
   * Trocea y vectoriza el ítem para que sea RECUPERABLE.
   *
   * ## Por qué no tumba la ingesta
   *
   * Vectorizar exige un proveedor externo, y ese proveedor puede faltar —una organización sin
   * perfil de IA configurado, una clave caducada, un corte— o rechazar la petición. Perder el
   * documento por eso sería desproporcionado: el contenido es válido, ya está normalizado,
   * clasificado, versionado y visible en su colección. Lo único que le falta es aparecer en una
   * búsqueda, y eso se puede recuperar volviendo a sincronizar cuando el proveedor esté.
   *
   * Se trata igual que un fallo de clasificación, con una diferencia importante: **se cuenta**.
   * Un documento que entra y no se puede preguntar es exactamente el caso en el que la persona
   * cree que el sistema no funciona, así que el recuento sube a las estadísticas del trabajo de
   * ingesta y de ahí a la pantalla.
   *
   * @returns `true` si quedó recuperable.
   */
  private async makeRetrievable(
    organizationId: string,
    outcome: IngestOutcome,
  ): Promise<boolean> {
    try {
      const result = await this.chunkAndEmbed.execute({
        organizationId,
        knowledgeItemId: outcome.knowledgeItemId,
      });
      // Cero fragmentos con contenido presente significaría que no hay nada que buscar: no es
      // un fallo, pero tampoco es recuperable.
      return result.chunksCreated > 0;
    } catch (error) {
      this.logger.warn(
        `El KnowledgeItem ${outcome.knowledgeItemId} entró pero NO es recuperable: ` +
          `${(error as Error).message}. El contenido está guardado y visible; no aparecerá ` +
          `al preguntar hasta que se vuelva a sincronizar con un proveedor disponible`,
      );
      return false;
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

  /**
   * Concilia lo que hay AHORA en el origen con lo que tenemos.
   *
   * Marca lo que ya no está y desmarca lo que ha vuelto. **No cambia el estado de nadie**: la
   * desaparición de un documento en su fuente no es una eliminación, es una observación.
   * Sacar un fichero de la carpeta vigilada es indistinguible de borrarlo, y aplicar
   * `DELETED` por nuestra cuenta retiraría conocimiento que la empresa sigue usando —
   * exactamente lo que §5 reserva a una decisión humana o administrativa.
   *
   * El contenido, el linaje y las versiones quedan intactos: esto es un atributo del mismo
   * ítem, como la confianza o la pertenencia a colecciones, que §5 ya permite cambiar sin
   * crear una versión nueva.
   *
   * Si el documento reaparece, se limpia la marca sobre EL MISMO ítem: no nace una identidad
   * nueva ni se duplica nada.
   */
  private async reconcileSourcePresence(params: {
    organizationId: string;
    knowledgeSourceId: string;
    presentSourceUrls: string[];
  }): Promise<void> {
    const present = params.presentSourceUrls.filter(
      (url) => typeof url === 'string' && url.length > 0,
    );

    // Solo se juzgan los ítems VIVOS de esta fuente. Uno superado ya no representa
    // conocimiento actual, y uno eliminado lo decidió una persona: ni uno ni otro deben
    // recibir una marca que solo habla de disponibilidad en el origen.
    const scope = {
      organizationId: params.organizationId,
      currentKnowledgeSourceId: params.knowledgeSourceId,
      status: {
        notIn: TERMINAL_KNOWLEDGE_ITEM_STATUSES as KnowledgeItemStatus[],
      },
    };

    const missing = await this.prisma.knowledgeItem.updateMany({
      where: {
        ...scope,
        sourceMissingSince: null,
        ...(present.length > 0 ? { sourceUrl: { notIn: present } } : {}),
      },
      data: { sourceMissingSince: new Date() },
    });

    const restored =
      present.length > 0
        ? await this.prisma.knowledgeItem.updateMany({
            where: {
              ...scope,
              sourceMissingSince: { not: null },
              sourceUrl: { in: present },
            },
            data: { sourceMissingSince: null },
          })
        : { count: 0 };

    if (missing.count === 0 && restored.count === 0) return;

    // Queda traza, y sin actor: no lo provocó una persona sino una sincronización.
    await this.audit.record({
      organizationId: params.organizationId,
      action: AUDIT_ACTIONS.KNOWLEDGE_SOURCE_PRESENCE_RECONCILED,
      targetType: AUDIT_TARGET_TYPES.KNOWLEDGE_SOURCE,
      targetId: params.knowledgeSourceId,
      metadata: {
        markedMissing: missing.count,
        restored: restored.count,
        presentAtSource: present.length,
        // Se declara explícitamente: esto NO es una eliminación.
        deletedAny: false,
      },
    });

    this.logger.log(
      `Presencia en el origen de la fuente ${params.knowledgeSourceId}: ` +
        `${missing.count} ausente(s), ${restored.count} recuperado(s). Ningún documento ` +
        `se elimina — la supresión es siempre una decisión humana`,
    );
  }
}

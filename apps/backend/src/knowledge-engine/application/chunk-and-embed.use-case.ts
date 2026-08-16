import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LlmProviderName, Prisma } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { ProviderRegistry } from '../../llm/application/provider-registry.service';
import {
  chunkContent,
  getChunkingSettings,
  type Chunk,
} from '../domain/chunking';

/**
 * Chunking y embeddings — KNOWLEDGE_ENGINE_DESIGN.md §11, §12, §3.6, §3.11.
 *
 * Opera sobre contenido YA resuelto (versión correcta, no duplicado, con clasificación y
 * confianza asignadas), para no fragmentar ni vectorizar contenido que luego se descarta
 * (§4, paso 7).
 *
 * Regenerar los vectores NO altera el contenido del `KnowledgeItem` ni crea una versión
 * nueva: es una operación sobre la REPRESENTACIÓN, no sobre el conocimiento (§5).
 */

/**
 * Modelo de embeddings oficial. La dimensionalidad (1536) está fijada en el esquema desde
 * la Fase 1: cambiar a un modelo de otra dimensión NO es una reindexación, es una migración
 * de esquema con su propio proceso (§12, hallazgo #12 de la auditoría).
 */
export const OFFICIAL_EMBEDDING_MODEL = 'text-embedding-3-small';
export const OFFICIAL_EMBEDDING_VERSION = 'v1';
export const EMBEDDING_DIMENSIONS = 1536;

/** Lotes por llamada al proveedor: se vectoriza por lotes, no un fragmento por petición (§12, "Costes"). */
const EMBEDDING_BATCH_SIZE = 64;

export interface ChunkAndEmbedResult {
  knowledgeItemId: string;
  chunksCreated: number;
  /** Vectores servidos desde caché de cómputo en vez de pedirse al proveedor (§7). */
  embeddingsReused: number;
  embeddingsComputed: number;
}

@Injectable()
export class ChunkAndEmbedUseCase {
  private readonly logger = new Logger(ChunkAndEmbedUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async execute(params: {
    organizationId: string;
    knowledgeItemId: string;
  }): Promise<ChunkAndEmbedResult> {
    const item = await this.prisma.knowledgeItem.findFirst({
      where: {
        id: params.knowledgeItemId,
        organizationId: params.organizationId,
      },
      select: { id: true, contentText: true },
    });
    if (!item) throw new NotFoundException('KnowledgeItem no encontrado');

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: params.organizationId },
      select: { settings: true },
    });

    const chunks = chunkContent(
      item.contentText,
      getChunkingSettings(organization.settings),
    );
    if (chunks.length === 0) {
      return {
        knowledgeItemId: item.id,
        chunksCreated: 0,
        embeddingsReused: 0,
        embeddingsComputed: 0,
      };
    }

    const vectors = await this.resolveVectors(params.organizationId, chunks);

    // Reemplazo atómico: los fragmentos anteriores desaparecen y los nuevos aparecen en la
    // misma transacción. Nunca se observa un KnowledgeItem con chunks a medio regenerar.
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeChunk.deleteMany({
        where: { knowledgeItemId: item.id },
      });

      for (const chunk of chunks) {
        const vector = vectors.byHash.get(chunk.contentHash)!;
        // `embedding` es de tipo pgvector, no expresable en el cliente Prisma: se escribe
        // con SQL parametrizado, nunca por interpolación de texto.
        await tx.$executeRaw`
          INSERT INTO "KnowledgeChunk"
            ("id", "knowledgeItemId", "organizationId", "chunkIndex", "content",
             "tokenCount", "metadata", "embedding", "embeddingModel", "embeddingVersion",
             "contentHash", "createdAt")
          VALUES (
            ${`chk_${item.id}_${chunk.index}`}, ${item.id}, ${params.organizationId},
            ${chunk.index}, ${chunk.content}, ${estimateTokens(chunk.content)},
            ${JSON.stringify(chunk.metadata)}::jsonb,
            ${`[${vector.join(',')}]`}::vector,
            ${OFFICIAL_EMBEDDING_MODEL}, ${OFFICIAL_EMBEDDING_VERSION},
            ${chunk.contentHash}, NOW()
          )`;
      }
    });

    this.logger.log(
      `KnowledgeItem ${item.id}: ${chunks.length} fragmentos, ` +
        `${vectors.computed} vectores calculados, ${vectors.reused} reutilizados`,
    );

    return {
      knowledgeItemId: item.id,
      chunksCreated: chunks.length,
      embeddingsReused: vectors.reused,
      embeddingsComputed: vectors.computed,
    };
  }

  /**
   * Resuelve el vector de cada fragmento. Reutiliza el CÓMPUTO cuando un fragmento con
   * contenido idéntico ya fue vectorizado con el mismo modelo (§7, "duplicados parciales"):
   * se evita la llamada al proveedor, pero cada chunk conserva su propio registro — nunca se
   * comparte un `Embedding` entre chunks de ítems distintos (§3.11, hallazgo #4).
   */
  private async resolveVectors(
    organizationId: string,
    chunks: Chunk[],
  ): Promise<{
    byHash: Map<string, number[]>;
    reused: number;
    computed: number;
  }> {
    const byHash = new Map<string, number[]>();
    const uniqueHashes = [...new Set(chunks.map((c) => c.contentHash))];

    const cached = await this.prisma.$queryRaw<
      { contentHash: string; embedding: string }[]
    >`
      SELECT DISTINCT ON ("contentHash") "contentHash", "embedding"::text AS embedding
      FROM "KnowledgeChunk"
      WHERE "organizationId" = ${organizationId}
        AND "embeddingModel" = ${OFFICIAL_EMBEDDING_MODEL}
        AND "contentHash" IN (${Prisma.join(uniqueHashes)})`;

    for (const row of cached) {
      byHash.set(row.contentHash, parseVector(row.embedding));
    }
    const reused = byHash.size;

    const missing = uniqueHashes.filter((h) => !byHash.has(h));
    if (missing.length > 0) {
      const { profile, provider } =
        await this.resolveEmbeddingProvider(organizationId);
      const textByHash = new Map(chunks.map((c) => [c.contentHash, c.content]));

      for (let i = 0; i < missing.length; i += EMBEDDING_BATCH_SIZE) {
        const batchHashes = missing.slice(i, i + EMBEDDING_BATCH_SIZE);
        const vectors = await provider.embed(
          batchHashes.map((h) => textByHash.get(h)!),
          OFFICIAL_EMBEDDING_MODEL,
          profile.apiKeyEnc ?? undefined,
        );

        vectors.forEach((vector, index) => {
          if (vector.length !== EMBEDDING_DIMENSIONS) {
            // Un vector de otra dimensión no cabe en el esquema y jamás debe escribirse:
            // el fallo es explícito, no un dato corrupto silencioso (§12).
            throw new Error(
              `El proveedor devolvió un vector de ${vector.length} dimensiones; ` +
                `el esquema exige ${EMBEDDING_DIMENSIONS} (modelo ${OFFICIAL_EMBEDDING_MODEL})`,
            );
          }
          byHash.set(batchHashes[index], vector);
        });
      }
    }

    return { byHash, reused, computed: missing.length };
  }

  private async resolveEmbeddingProvider(organizationId: string) {
    const orgProfile = await this.prisma.llmProfile.findFirst({
      where: { organizationId, isDefault: true },
    });
    const profile =
      orgProfile ??
      (await this.prisma.llmProfile.findFirst({
        where: { organizationId: null, isDefault: true },
      }));
    if (!profile) {
      // Precondición operativa: hace falta que un administrador configure un perfil. No es
      // un fallo del sistema ni una petición mal formada.
      throw new ServiceUnavailableException(
        'La organización no tiene ningún perfil de IA configurado y la plataforma tampoco ' +
          'aporta uno por defecto. Configure un LlmProfile antes de ingerir o consultar.',
      );
    }

    // El proveedor de embeddings puede no coincidir con el conversacional (§12): hoy solo
    // OpenAI implementa el puerto de embeddings.
    return {
      profile,
      provider: this.providerRegistry.getEmbeddingProvider(
        LlmProviderName.OPENAI,
      ),
    };
  }
}

/** Aproximación de tokens sin dependencia externa: suficiente para el presupuesto de contexto (§14). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function parseVector(raw: string): number[] {
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(Number);
}

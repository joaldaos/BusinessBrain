import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LlmProviderName, Prisma } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isEmptyScope,
  scopeFilter,
  type KnowledgeScope,
} from '../domain/knowledge-scope';
import { ProviderRegistry } from '../../llm/application/provider-registry.service';
import { CanonicalizeUseCase } from './canonicalize.use-case';
import {
  OFFICIAL_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
} from './chunk-and-embed.use-case';
import {
  DEFAULT_MAX_CHUNKS_PER_ITEM,
  enforceDiversity,
  lexicalOverlap,
  rankCandidates,
  resolveConfidenceFloor,
  type RankedResult,
  type RetrievalCandidate,
} from '../domain/retrieval-ranking';
import { TERMINAL_KNOWLEDGE_ITEM_STATUSES } from '../domain/knowledge-item-status.classification';

/**
 * Retrieval — KNOWLEDGE_ENGINE_DESIGN.md §13.
 *
 * ÚNICA puerta de entrada a la recuperación semántica. Ninguna superficie de consumo
 * consulta `KnowledgeChunk` ni el almacén vectorial directamente (§15): no existe, por
 * diseño, un camino alternativo de lectura.
 *
 * Subfase 2.7: capacidad interna, sin consumidores conectados todavía.
 */

/** Candidatos que se traen del almacén vectorial antes de filtrar y rankear. */
const CANDIDATE_POOL_SIZE = 60;
const DEFAULT_LIMIT = 10;

export interface RetrieveContextParams {
  /** Obligatorio y no negociable: primer filtro, sin excepción (§13, paso 3). */
  organizationId: string;
  query: string;
  /**
   * Alcance de conocimiento del consumidor (§13 paso 5, §535). OBLIGATORIO desde 6.3.
   *
   * Antes era una lista opcional, y omitirla devolvía toda la organización: la corrección
   * dependía de que cada llamante se acordara, y el olvido no producía ningún error visible.
   * Ahora omitirlo no compila, y leer toda la organización exige declararlo con motivo.
   */
  scope: KnowledgeScope;
  /** Endurece el piso de confianza; nunca puede relajarlo (§8.5). */
  minimumConfidence?: number;
  limit?: number;
  maxChunksPerItem?: number;
  /**
   * Modo histórico (§13, paso 4): permite ver ítems reemplazados o no canónicos, p. ej.
   * para una auditoría que necesita reconstruir qué se sabía antes. Nunca por omisión.
   */
  historicalMode?: boolean;
}

export interface RetrievedChunk {
  chunkId: string;
  content: string;
  score: number;
  factors: RankedResult['factors'];
  /** Referencia lista para citar (§14): documento, posición y encabezado. */
  citation: {
    knowledgeItemId: string;
    title: string;
    chunkIndex: number;
    heading: string | null;
    headingPath: string[];
  };
  confidenceScore: number;
}

@Injectable()
export class RetrieveContextUseCase {
  private readonly logger = new Logger(RetrieveContextUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly canonicalize: CanonicalizeUseCase,
  ) {}

  async execute(params: RetrieveContextParams): Promise<RetrievedChunk[]> {
    // Sin ninguna colección concedida no hay nada que recuperar. Se corta aquí: construir la
    // consulta con una lista vacía no es SQL válido, y —más importante— este retorno hace
    // explícito que "sin concesiones" significa "nada", jamás "todo".
    if (isEmptyScope(params.scope)) return [];

    if (params.scope.mode === 'ORGANIZATION_WIDE') {
      // Leer toda la organización queda declarado en el registro con su motivo: es la única
      // forma de que una lectura sin acotar sea revisable después.
      this.logger.debug(
        `Recuperación de alcance ORGANIZATION_WIDE en ${params.organizationId}: ` +
          params.scope.reason,
      );
    }

    const now = new Date();

    // Paso 1 — vectorización de la consulta con el MISMO modelo activo para la organización:
    // nunca se compara contra vectores de un modelo distinto (§12, §13 paso 1).
    const queryVector = await this.embedQuery(
      params.organizationId,
      params.query,
    );

    // Pasos 2-6 — recuperación híbrida y filtros, resueltos en la consulta para que el
    // filtro de organización sea estructural y no un paso posterior omitible (§15).
    const candidates = await this.fetchCandidates(params, queryVector);

    // Paso 7 — re-ranking combinando similitud, confianza y recencia.
    const ranked = rankCandidates(candidates, now);

    // Paso 8 — control de diversidad.
    const diverse = enforceDiversity(
      ranked,
      params.maxChunksPerItem ?? DEFAULT_MAX_CHUNKS_PER_ITEM,
    );

    // Paso 9 — entrega con la referencia de cita lista para el Context Builder (§14).
    return diverse.slice(0, params.limit ?? DEFAULT_LIMIT).map((result) => ({
      chunkId: result.chunkId,
      content: result.content,
      score: result.score,
      factors: result.factors,
      citation: {
        knowledgeItemId: result.knowledgeItemId,
        title: result.knowledgeItemTitle,
        chunkIndex: result.chunkIndex,
        heading: (result.metadata.heading as string | null) ?? null,
        headingPath: (result.metadata.headingPath as string[]) ?? [],
      },
      confidenceScore: result.confidenceScore,
    }));
  }

  private async embedQuery(
    organizationId: string,
    query: string,
  ): Promise<number[]> {
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

    const provider = this.providerRegistry.getEmbeddingProvider(
      LlmProviderName.OPENAI,
    );
    const [vector] = await provider.embed(
      [query],
      OFFICIAL_EMBEDDING_MODEL,
      profile.apiKeyEnc ?? undefined,
    );

    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `La consulta se vectorizó con ${vector.length} dimensiones; el índice exige ${EMBEDDING_DIMENSIONS}`,
      );
    }
    return vector;
  }

  private async fetchCandidates(
    params: RetrieveContextParams,
    queryVector: number[],
  ): Promise<RetrievalCandidate[]> {
    const floor = resolveConfidenceFloor(params.minimumConfidence);

    // Paso 4 — filtro de estado y canonicidad: OBLIGATORIO y no configurable. Se excluyen
    // los ítems en estado terminal y los miembros NO canónicos de un grupo resuelto. Solo
    // el modo histórico explícito lo omite, nunca por defecto (§13, paso 4).
    const excludedItemIds = params.historicalMode
      ? []
      : await this.canonicalize.listNonCanonicalItemIds(params.organizationId);

    // El enum de Postgres no admite comparación directa con parámetros de texto en SQL
    // crudo: se compara sobre su representación textual, que es estable y verificada por el
    // test de contrato de clasificación activo/terminal.
    const statusFilter = params.historicalMode
      ? Prisma.sql`TRUE`
      : Prisma.sql`ki."status"::text NOT IN (${Prisma.join(
          TERMINAL_KNOWLEDGE_ITEM_STATUSES,
        )})`;

    const nonCanonicalFilter =
      excludedItemIds.length > 0
        ? Prisma.sql`AND ki."id" NOT IN (${Prisma.join(excludedItemIds)})`
        : Prisma.empty;

    // Paso 5 — alcance por colección permitida al consumidor.
    //
    // `scopeFilter` devuelve `null` SOLO para el alcance de organización completa. Una lista
    // vacía sigue siendo una lista: filtra por nada y no devuelve nada. Confundir ambos casos
    // era el fail-open que 6.3 cierra.
    const allowedCollectionIds = scopeFilter(params.scope);
    const collectionFilter =
      allowedCollectionIds === null
        ? Prisma.empty
        : Prisma.sql`AND EXISTS (
            SELECT 1 FROM "KnowledgeItemCollection" kic
            WHERE kic."knowledgeItemId" = ki."id"
              AND kic."knowledgeCollectionId" IN (${Prisma.join(allowedCollectionIds)}))`;

    const rows = await this.prisma.$queryRaw<
      {
        chunkId: string;
        knowledgeItemId: string;
        content: string;
        chunkIndex: number;
        metadata: Record<string, unknown>;
        title: string;
        distance: number;
        confidenceScore: number;
        indexedAt: Date | null;
        createdAt: Date;
      }[]
    >`
      SELECT
        kc."id"              AS "chunkId",
        kc."knowledgeItemId" AS "knowledgeItemId",
        kc."content"         AS "content",
        kc."chunkIndex"      AS "chunkIndex",
        kc."metadata"        AS "metadata",
        ki."title"           AS "title",
        (kc."embedding" <=> ${`[${queryVector.join(',')}]`}::vector) AS "distance",
        ki."confidenceScore" AS "confidenceScore",
        ki."indexedAt"       AS "indexedAt",
        ki."createdAt"       AS "createdAt"
      FROM "KnowledgeChunk" kc
      JOIN "KnowledgeItem" ki ON ki."id" = kc."knowledgeItemId"
      WHERE kc."organizationId" = ${params.organizationId}
        AND ki."organizationId" = ${params.organizationId}
        AND kc."embeddingModel" = ${OFFICIAL_EMBEDDING_MODEL}
        AND ${statusFilter}
        ${nonCanonicalFilter}
        ${collectionFilter}
        AND COALESCE(ki."confidenceScore", 0) >= ${floor}
      ORDER BY "distance" ASC
      LIMIT ${CANDIDATE_POOL_SIZE}`;

    return rows.map((row) => ({
      chunkId: row.chunkId,
      knowledgeItemId: row.knowledgeItemId,
      content: row.content,
      chunkIndex: row.chunkIndex,
      metadata: row.metadata ?? {},
      knowledgeItemTitle: row.title,
      vectorDistance: Number(row.distance),
      lexicalScore: lexicalOverlap(params.query, row.content),
      confidenceScore: Number(row.confidenceScore ?? 0),
      indexedAt: row.indexedAt ?? row.createdAt,
    }));
  }
}

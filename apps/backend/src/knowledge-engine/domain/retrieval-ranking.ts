/**
 * Re-ranking y control de diversidad — KNOWLEDGE_ENGINE_DESIGN.md §13, pasos 7 y 8.
 *
 * Funciones puras: la decisión de qué se entrega y en qué orden debe poder explicarse y
 * reproducirse, igual que la canonicalización o la confianza.
 */

/** Piso mínimo de confianza de plataforma (§8.5). Activo por defecto, endurecible, nunca desactivable. */
export const PLATFORM_MINIMUM_CONFIDENCE = 0.2;

export interface RankingWeights {
  similarity: number;
  confidence: number;
  recency: number;
}

/** Ninguno de los tres domina por sí solo (§13, paso 7). */
export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  similarity: 0.6,
  confidence: 0.25,
  recency: 0.15,
};

export const RECENCY_WINDOW_DAYS = 365;

/** Cuántos fragmentos del mismo documento pueden aparecer en un resultado (§13, paso 8). */
export const DEFAULT_MAX_CHUNKS_PER_ITEM = 3;

export interface RetrievalCandidate {
  chunkId: string;
  knowledgeItemId: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
  knowledgeItemTitle: string;
  /** Distancia coseno de pgvector: 0 = idéntico. */
  vectorDistance: number;
  /** Coincidencia léxica en [0,1] — precisa para nombres propios, códigos y cifras (§13, paso 2). */
  lexicalScore: number;
  confidenceScore: number;
  indexedAt: Date;
}

export interface RankedResult extends RetrievalCandidate {
  score: number;
  factors: { similarity: number; confidence: number; recency: number };
}

/**
 * Combina similitud vectorial y léxica en un único valor. Depender solo de la vectorial
 * pierde precisión exacta en nombres y códigos; depender solo del léxico pierde la
 * capacidad de entender la intención (§13, paso 2).
 */
export function combineSimilarity(
  vectorDistance: number,
  lexicalScore: number,
): number {
  const vectorSimilarity = Math.max(0, 1 - vectorDistance);
  return vectorSimilarity * 0.75 + lexicalScore * 0.25;
}

export function rankCandidates(
  candidates: RetrievalCandidate[],
  now: Date,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): RankedResult[] {
  return candidates
    .map((candidate) => {
      const ageDays = Math.max(
        0,
        (now.getTime() - candidate.indexedAt.getTime()) / 86_400_000,
      );
      const factors = {
        similarity: combineSimilarity(
          candidate.vectorDistance,
          candidate.lexicalScore,
        ),
        confidence: candidate.confidenceScore,
        recency: Math.max(0, 1 - ageDays / RECENCY_WINDOW_DAYS),
      };

      const score =
        factors.similarity * weights.similarity +
        factors.confidence * weights.confidence +
        factors.recency * weights.recency;

      return { ...candidate, score: Number(score.toFixed(6)), factors };
    })
    .sort((a, b) =>
      // Desempate estable por id: el orden no puede depender del de llegada.
      b.score !== a.score
        ? b.score - a.score
        : a.chunkId.localeCompare(b.chunkId),
    );
}

/**
 * Limita cuántos fragmentos del mismo `KnowledgeItem` aparecen, para que un único documento
 * muy relevante no monopolice el contexto a costa de otras fuentes también útiles (§13, paso 8).
 */
export function enforceDiversity(
  ranked: RankedResult[],
  maxPerItem: number = DEFAULT_MAX_CHUNKS_PER_ITEM,
): RankedResult[] {
  const seen = new Map<string, number>();
  const result: RankedResult[] = [];

  for (const candidate of ranked) {
    const count = seen.get(candidate.knowledgeItemId) ?? 0;
    if (count >= maxPerItem) continue;
    seen.set(candidate.knowledgeItemId, count + 1);
    result.push(candidate);
  }

  return result;
}

/**
 * Resuelve el piso de confianza efectivo. Un consumidor puede ENDURECERLO, nunca relajarlo
 * por debajo del mínimo de plataforma (§8.5) — la promesa de §5 de excluir por defecto el
 * conocimiento decaído depende de que este piso no se pueda desactivar.
 */
export function resolveConfidenceFloor(requested?: number): number {
  if (
    typeof requested === 'number' &&
    requested > PLATFORM_MINIMUM_CONFIDENCE
  ) {
    return requested;
  }
  return PLATFORM_MINIMUM_CONFIDENCE;
}

/** Coincidencia léxica simple por solapamiento de términos, sin dependencias externas. */
export function lexicalOverlap(query: string, content: string): number {
  const terms = new Set(
    query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2),
  );
  if (terms.size === 0) return 0;

  const haystack = content.toLowerCase();
  let matched = 0;
  for (const term of terms) {
    if (haystack.includes(term)) matched += 1;
  }
  return matched / terms.size;
}

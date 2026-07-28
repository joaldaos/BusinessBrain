import { KnowledgeSourceType } from '@businessbrain/database';
import { DEFAULT_SOURCE_TRUST } from './confidence';

/**
 * Resolución de canonicalización — KNOWLEDGE_ENGINE_DESIGN.md §10.
 *
 * Decide cuál de varios `KnowledgeItem` que describen el mismo hecho prevalece, sin
 * destruir los demás. Función pura y determinista: la decisión debe poder explicarse y
 * reproducirse, no solo consultarse.
 *
 * Regla central: solo se resuelve automáticamente cuando hay GANADOR CLARO. Ante empate o
 * diferencia insuficiente el grupo queda en conflicto y se expone a revisión humana — el
 * sistema no finge una certeza que no tiene.
 */

/**
 * Umbral de margen por defecto de plataforma: diferencia mínima de score entre el primero y
 * el segundo para considerar que hay ganador claro. Configuración por organización, nunca
 * constante de código (§10, hallazgo #10 de la auditoría).
 */
export const DEFAULT_CANONICAL_WINNER_MARGIN = 0.15;

interface OrganizationSettingsShape {
  knowledgeEngine?: {
    canonicalization?: { winnerMargin?: number };
  };
}

export function getCanonicalWinnerMargin(
  organizationSettings: unknown,
): number {
  const configured = (
    organizationSettings as OrganizationSettingsShape | null | undefined
  )?.knowledgeEngine?.canonicalization?.winnerMargin;

  if (typeof configured === 'number' && configured > 0 && configured < 1) {
    return configured;
  }
  return DEFAULT_CANONICAL_WINNER_MARGIN;
}

/** Pesos de los tres criterios de ordenación de §10. */
export const CANONICAL_RANKING_WEIGHTS = {
  currentConfidence: 0.5,
  sourceTrust: 0.3,
  recency: 0.2,
} as const;

/** Ventana en días sobre la que se normaliza la recencia. */
export const RECENCY_WINDOW_DAYS = 365;

export interface CanonicalCandidateInput {
  knowledgeItemId: string;
  /** Confianza actual del ítem (§8). */
  confidenceScore: number;
  /** Tipo del conector que lo originó; `null` si no tiene procedencia. */
  sourceType: KnowledgeSourceType | null;
  /** Fecha de indexación, base de la recencia. */
  indexedAt: Date;
}

export interface RankedCandidate {
  knowledgeItemId: string;
  score: number;
  factors: {
    currentConfidence: number;
    sourceTrust: number;
    recency: number;
  };
}

export interface CanonicalResolution {
  status: 'RESOLVED' | 'IN_CONFLICT';
  winnerKnowledgeItemId: string | null;
  /** Diferencia entre el primero y el segundo. `null` con un solo candidato. */
  margin: number | null;
  ranking: RankedCandidate[];
  rationale: string;
}

/**
 * Ordena los candidatos por confianza actual, confianza base de la fuente y recencia —
 * los tres criterios que §10 fija, sin que ninguno domine por sí solo.
 */
function rankCandidates(
  candidates: CanonicalCandidateInput[],
  now: Date,
): RankedCandidate[] {
  return candidates
    .map((candidate) => {
      const sourceTrust = candidate.sourceType
        ? DEFAULT_SOURCE_TRUST[candidate.sourceType]
        : DEFAULT_SOURCE_TRUST.FILE_UPLOAD;

      const ageDays = Math.max(
        0,
        (now.getTime() - candidate.indexedAt.getTime()) / 86_400_000,
      );
      // Recencia normalizada: 1 = recién indexado, 0 = fuera de la ventana.
      const recency = Math.max(0, 1 - ageDays / RECENCY_WINDOW_DAYS);

      const factors = {
        currentConfidence: candidate.confidenceScore,
        sourceTrust,
        recency,
      };

      const score =
        factors.currentConfidence *
          CANONICAL_RANKING_WEIGHTS.currentConfidence +
        factors.sourceTrust * CANONICAL_RANKING_WEIGHTS.sourceTrust +
        factors.recency * CANONICAL_RANKING_WEIGHTS.recency;

      return {
        knowledgeItemId: candidate.knowledgeItemId,
        score: Number(score.toFixed(4)),
        factors,
      };
    })
    .sort((a, b) =>
      // Desempate estable por id: dos candidatos con score idéntico deben producir
      // siempre el mismo orden, para que la resolución sea reproducible.
      b.score !== a.score
        ? b.score - a.score
        : a.knowledgeItemId.localeCompare(b.knowledgeItemId),
    );
}

/**
 * Resuelve un grupo canónico. `currentWinnerId` permite aplicar la regla de §10 sobre la
 * aparición de una fuente nueva: un candidato recién llegado NO desplaza automáticamente al
 * canónico establecido — debe ganar por el mismo margen que cualquier otro.
 */
export function resolveCanonicalGroup(params: {
  candidates: CanonicalCandidateInput[];
  winnerMargin: number;
  now: Date;
  currentWinnerId?: string | null;
}): CanonicalResolution {
  const ranking = rankCandidates(params.candidates, params.now);

  if (ranking.length === 0) {
    return {
      status: 'IN_CONFLICT',
      winnerKnowledgeItemId: null,
      margin: null,
      ranking,
      rationale: 'Grupo sin candidatos activos',
    };
  }

  if (ranking.length === 1) {
    return {
      status: 'RESOLVED',
      winnerKnowledgeItemId: ranking[0].knowledgeItemId,
      margin: null,
      ranking,
      rationale: 'Candidato único: no hay conflicto que resolver',
    };
  }

  const [first, second] = ranking;
  const margin = Number((first.score - second.score).toFixed(4));

  if (margin < params.winnerMargin) {
    return {
      status: 'IN_CONFLICT',
      // Se conserva el canónico anterior si lo había: un empate no debe dejar al grupo sin
      // versión oficial ni desplazar al establecido por un margen insuficiente (§10).
      winnerKnowledgeItemId: params.currentWinnerId ?? null,
      margin,
      ranking,
      rationale:
        `Diferencia de ${margin} entre los dos primeros, por debajo del umbral ` +
        `${params.winnerMargin}: no se resuelve automáticamente, queda para revisión humana`,
    };
  }

  return {
    status: 'RESOLVED',
    winnerKnowledgeItemId: first.knowledgeItemId,
    margin,
    ranking,
    rationale:
      `Ganador claro por ${margin} sobre el siguiente candidato ` +
      `(umbral ${params.winnerMargin})`,
  };
}

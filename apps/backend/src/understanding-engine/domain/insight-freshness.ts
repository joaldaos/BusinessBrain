/**
 * `EvidenceFreshness` y decaimiento de confianza de un `Insight` —
 * UNDERSTANDING_ENGINE_DESIGN.md §3.4, §5, §9.
 *
 * La obsolescencia se EVALÚA, nunca se propaga. Ésta es la garantía central: la vigencia
 * se determina consultando el estado actual de la evidencia del cierre, no esperando a que
 * una cascada asíncrona marque el `Insight`.
 *
 * Un modelo de propagación puede degradarse SILENCIOSAMENTE ante un evento perdido, un
 * worker caído o una cascada truncada por su cota, y el estado erróneo resultante es
 * indistinguible del correcto. Una evaluación en lectura falla de forma visible y
 * reintentable, nunca con una respuesta incorrecta creíble.
 */

/** Estado de frescura. NO es un estado del ciclo de vida: es una proyección derivada (§5). */
export type EvidenceFreshness = 'FRESH' | 'STALE' | 'UNRESOLVABLE';

export interface EvidenceState {
  refId: string;
  /** Instante del último cambio relevante de esta evidencia. `null` si no se pudo resolver. */
  lastChangedAt: Date | null;
  /** La evidencia ya no existe: purgada, o el `Insight` citado fue descartado o superado. */
  unresolvable: boolean;
}

export interface FreshnessInput {
  /** Momento en que el `Insight` se calculó por última vez. */
  computedAt: Date;
  /** Estado actual de cada evidencia de su `TransitiveEvidenceClosure`. */
  evidenceStates: EvidenceState[];
}

export interface FreshnessResult {
  freshness: EvidenceFreshness;
  /** Evidencias que han cambiado desde el cálculo. */
  changedRefIds: string[];
  unresolvableRefIds: string[];
  rationale: string;
}

/**
 * Proyecta la frescura sobre el estado actual de la evidencia. Función pura: no lee reloj
 * ni base de datos, para que el resultado sea reproducible y testeable.
 *
 * Qué cuenta como cambio relevante lo decide ESTE dominio (§3.4): el Knowledge Engine
 * entrega hechos —versión, estado, pertenencia— y jamás el veredicto de si un cambio
 * invalida un razonamiento.
 */
export function evaluateFreshness(input: FreshnessInput): FreshnessResult {
  const unresolvableRefIds = input.evidenceStates
    .filter((state) => state.unresolvable)
    .map((state) => state.refId);

  const changedRefIds = input.evidenceStates
    .filter(
      (state) =>
        !state.unresolvable &&
        state.lastChangedAt !== null &&
        state.lastChangedAt.getTime() > input.computedAt.getTime(),
    )
    .map((state) => state.refId);

  if (unresolvableRefIds.length > 0) {
    // Evidencia purgada o retirada: el razonamiento ya no puede sostenerse ni verificarse.
    // Nunca desaparece en silencio — queda registrado como no vigente (§3.4).
    return {
      freshness: 'UNRESOLVABLE',
      changedRefIds,
      unresolvableRefIds,
      rationale:
        `${unresolvableRefIds.length} pieza(s) de evidencia ya no pueden resolverse: ` +
        `el razonamiento no es verificable y queda pendiente de recálculo`,
    };
  }

  if (changedRefIds.length > 0) {
    return {
      freshness: 'STALE',
      changedRefIds,
      unresolvableRefIds,
      rationale:
        `${changedRefIds.length} pieza(s) de evidencia han cambiado desde que se calculó: ` +
        `la conclusión sigue siendo consultable, pero no se presenta como vigente`,
    };
  }

  return {
    freshness: 'FRESH',
    changedRefIds: [],
    unresolvableRefIds: [],
    rationale: 'Toda la evidencia sigue intacta desde el último cálculo',
  };
}

/**
 * Decaimiento de confianza de un `Insight` sin recorroboración — §9.
 *
 * Mismo mecanismo y misma exigencia de configuración explícita que el decaimiento de
 * `KnowledgeItem` (`KNOWLEDGE_ENGINE_DESIGN.md` §8.3), con velocidad configurable por tipo:
 * una observación puntual envejece más rápido que un patrón sostenido en el tiempo.
 */
export const DEFAULT_INSIGHT_HALF_LIFE_DAYS: Readonly<Record<string, number>> =
  {
    // Un patrón se apoya en recurrencia: pierde vigencia despacio.
    PATTERN: 180,
    // Una anomalía es puntual: envejece rápido.
    ANOMALY: 60,
    // Los juicios de valor viven mientras viva el objetivo que los ancla.
    RISK: 120,
    OPPORTUNITY: 120,
  };

export const DEFAULT_INSIGHT_CONFIDENCE_FLOOR = 0.1;

export interface InsightDecayInput {
  currentConfidence: number;
  computedAt: Date;
  now: Date;
  type: string;
  halfLifeDays?: number;
  floor?: number;
}

export function applyInsightDecay(input: InsightDecayInput): number {
  const halfLife =
    input.halfLifeDays ?? DEFAULT_INSIGHT_HALF_LIFE_DAYS[input.type] ?? 120;
  const floor = input.floor ?? DEFAULT_INSIGHT_CONFIDENCE_FLOOR;

  if (input.currentConfidence <= floor) return input.currentConfidence;

  const elapsedDays = Math.max(
    0,
    (input.now.getTime() - input.computedAt.getTime()) / 86_400_000,
  );

  // Exponencial hacia el piso, igual que en el Knowledge Engine: nunca lo cruza.
  const decayed =
    floor +
    (input.currentConfidence - floor) * Math.pow(0.5, elapsedDays / halfLife);

  return Number(decayed.toFixed(4));
}

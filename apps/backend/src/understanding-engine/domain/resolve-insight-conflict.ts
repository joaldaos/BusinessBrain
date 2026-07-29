import { InsightType } from '@businessbrain/database';

/**
 * `ResolveInsightConflict` — UNDERSTANDING_ENGINE_DESIGN.md §12, §9.
 *
 * Reconcilia dos afirmaciones que comparten **identidad de sujeto** (§3.4): decide si se
 * corroboran, se contradicen, o ninguna de las dos cosas.
 *
 * Es INDEPENDIENTE de si los candidatos surgen dentro del mismo `AnalysisRun` o de
 * ejecuciones distintas a lo largo del tiempo (§12): la diferencia entre ambos escenarios
 * es de origen del evento y de implementación, no de dominio — la responsabilidad funcional
 * es la misma.
 *
 * Función pura y determinista: la decisión debe poder explicarse y reproducirse.
 */

/** Cuánto sube la confianza una corroboración genuinamente independiente. */
export const CORROBORATION_BOOST = 0.05;
/** Cuánto baja ante una contradicción. Nunca se ignora en silencio (§9). */
export const CONTRADICTION_PENALTY = 0.1;
/** La confianza nunca sale del rango normalizado. */
export const CONFIDENCE_CEILING = 1;
export const CONFIDENCE_FLOOR = 0;

export type ConflictOutcome =
  /** Ambos afirman lo mismo desde cadenas independientes: sube la confianza. */
  | 'CORROBORATED'
  /** Afirman cosas incompatibles sobre el mismo asunto: baja y queda registrado. */
  | 'CONTRADICTED'
  /**
   * Coinciden, pero sus cadenas comparten un `Insight` ancestro: NO es evidencia
   * independiente y no puede subir la confianza (§9).
   */
  | 'NOT_INDEPENDENT'
  /** Nada que reconciliar más allá de reconocer que el asunto ya está representado. */
  | 'NO_CHANGE';

export interface ConflictParty {
  /** Tipo afirmado sobre el asunto. */
  type: InsightType;
  confidence: number;
  /**
   * Cierre transitivo de la evidencia. Se compara para decidir si las dos cadenas son
   * realmente independientes (§9).
   */
  evidenceRefIds: string[];
  /** Estrategia que lo produjo: dos afirmaciones de la misma no son independientes. */
  strategyKey: string;
}

export interface ConflictResolution {
  outcome: ConflictOutcome;
  /** Confianza que debe quedar en el `Insight` existente tras la reconciliación. */
  resolvedConfidence: number;
  /** Referencias compartidas que impidieron tratarlo como corroboración independiente. */
  sharedEvidenceRefIds: string[];
  rationale: string;
}

/**
 * Dos afirmaciones sobre el mismo sujeto se contradicen cuando afirman tipos distintos: una
 * dice que el asunto es un patrón sostenido y otra que es una desviación puntual, o una lo
 * eleva a juicio de valor y otra no. No es un desacuerdo de matiz: es una discrepancia
 * sobre la naturaleza del hallazgo.
 */
function contradicts(a: ConflictParty, b: ConflictParty): boolean {
  return a.type !== b.type;
}

/**
 * Regla de independencia de §9. Dos candidatos NO son corroboración independiente cuando:
 *
 * - los produjo la misma estrategia — repetir el mismo mecanismo no aporta evidencia nueva; o
 * - sus cadenas de evidencia comparten alguna referencia — ambos dependen de la misma
 *   fuente, y tratarlos como independientes "lavaría" la confianza de esa fuente por
 *   convergencia aparente, no por evidencia realmente distinta.
 */
function sharedEvidence(a: ConflictParty, b: ConflictParty): string[] {
  const other = new Set(b.evidenceRefIds);
  return a.evidenceRefIds.filter((refId) => other.has(refId));
}

function clamp(value: number): number {
  return Number(
    Math.min(CONFIDENCE_CEILING, Math.max(CONFIDENCE_FLOOR, value)).toFixed(4),
  );
}

/**
 * @param existing  Afirmación ya persistida sobre el asunto.
 * @param incoming  Candidato nuevo que comparte su identidad de sujeto.
 */
export function resolveInsightConflict(
  existing: ConflictParty,
  incoming: ConflictParty,
): ConflictResolution {
  const shared = sharedEvidence(existing, incoming);
  const sameStrategy = existing.strategyKey === incoming.strategyKey;

  if (contradicts(existing, incoming)) {
    // Una contradicción NUNCA se ignora en silencio, aunque las cadenas no sean
    // independientes: queda registrada y baja la confianza (§9).
    return {
      outcome: 'CONTRADICTED',
      resolvedConfidence: clamp(existing.confidence - CONTRADICTION_PENALTY),
      sharedEvidenceRefIds: shared,
      rationale:
        `Dos estrategias discrepan sobre la naturaleza del mismo asunto ` +
        `(${existing.type} frente a ${incoming.type}): la confianza baja y la ` +
        `discrepancia queda registrada`,
    };
  }

  if (sameStrategy) {
    return {
      outcome: 'NOT_INDEPENDENT',
      resolvedConfidence: existing.confidence,
      sharedEvidenceRefIds: shared,
      rationale:
        `Ambas afirmaciones proceden de la misma estrategia (${existing.strategyKey}): ` +
        `repetir el mismo mecanismo no aporta evidencia independiente`,
    };
  }

  if (shared.length > 0) {
    // Éste es el caso que la regla de §9 existe para impedir: dos cadenas que convergen
    // solo porque dependen de la misma fuente.
    return {
      outcome: 'NOT_INDEPENDENT',
      resolvedConfidence: existing.confidence,
      sharedEvidenceRefIds: shared,
      rationale:
        `Las cadenas de evidencia comparten ${shared.length} referencia(s): ambas dependen ` +
        `de la misma fuente y no constituyen corroboración independiente`,
    };
  }

  return {
    outcome: 'CORROBORATED',
    resolvedConfidence: clamp(existing.confidence + CORROBORATION_BOOST),
    sharedEvidenceRefIds: [],
    rationale:
      `Dos estrategias independientes (${existing.strategyKey} y ${incoming.strategyKey}) ` +
      `llegan a la misma conclusión sin compartir evidencia: la confianza sube`,
  };
}

import {
  evaluateCollectionScopeCoverage,
  type ScopeCoverageDecision,
  type ScopeCoverageDenialReason,
} from '../../understanding-engine/domain/collection-scope-coverage';

/**
 * Autorización de lectura de una `Recommendation` — UNDERSTANDING_ENGINE_DESIGN.md §3.4, §12.
 *
 * Una `Recommendation` hereda el `EffectiveCollectionScope` del `Insight` que la originó. Ese
 * alcance no es metadato: es la lista de colecciones cuya evidencia sostiene la propuesta.
 * Enseñársela a alguien que no puede ver esa evidencia sería blanquear el alcance — la misma
 * vía que `EscalateInsightToRecommendation` cierra al propagarlo.
 *
 * **Delega en la definición canónica del Understanding Engine** (subfase 6.1). Hasta 5.8 la
 * regla vivía aquí duplicada; cuando apareció el tercer consumidor —la autorización del actor
 * al curar y escalar— quedó claro que mantener copias significaba admitir que una misma
 * conclusión restringida pudiera volverse visible según por qué puerta se entrara. El dueño
 * de la regla es el módulo dueño del concepto, y la dirección Understanding → Recommendations
 * es la del resto de la arquitectura.
 */

export type RecommendationAccessDenialReason = ScopeCoverageDenialReason;
export type RecommendationAccessDecision = ScopeCoverageDecision;

export interface RecommendationAccessRequest {
  /** Alcance efectivo heredado del `Insight` de origen. */
  effectiveCollectionScope: string[];
  /** Colecciones que el consumidor tiene concedidas. */
  allowedCollectionIds: string[];
}

export function evaluateRecommendationAccess(
  request: RecommendationAccessRequest,
): RecommendationAccessDecision {
  return evaluateCollectionScopeCoverage(request);
}

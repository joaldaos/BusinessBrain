/**
 * Autorización de lectura de una `Recommendation` — UNDERSTANDING_ENGINE_DESIGN.md §3.4, §12.
 *
 * Una `Recommendation` hereda el `EffectiveCollectionScope` del `Insight` que la originó.
 * Ese alcance no es metadato: es la lista de colecciones cuya evidencia sostiene la
 * propuesta. Enseñársela a alguien que no puede ver esa evidencia sería blanquear el
 * alcance — la misma vía que `EscalateInsightToRecommendation` cierra al propagarlo.
 *
 * Dominio puro: sin base de datos, sin red, determinista. La regla es la MISMA que aplica
 * `RetrieveInsights`, y eso es deliberado: dos criterios distintos para el mismo alcance
 * significarían que una conclusión restringida se vuelve visible según por qué puerta se
 * entre.
 *
 * Dos invariantes, ambas fail-closed:
 *
 * 1. **Cobertura COMPLETA.** El acceso parcial deniega; nunca concede parcialmente. Ver la
 *    mitad de la evidencia no da derecho a ver la conclusión: precisamente lo que hace
 *    sensible una propuesta es la combinación de lo que la sostiene.
 * 2. **Alcance vacío = inaccesible.** Una `Recommendation` sin alcance es una cuya evidencia
 *    no pertenece a ninguna colección o no resuelve. Tratarla como "sin restricciones"
 *    convertiría el fallo más silencioso —evidencia huérfana— en acceso universal.
 */

export type RecommendationAccessDenialReason =
  'EMPTY_SCOPE' | 'SCOPE_NOT_COVERED';

export type RecommendationAccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: RecommendationAccessDenialReason;
      explanation: string;
      /** Colecciones del alcance que el consumidor NO cubre. Vacío si el alcance lo estaba. */
      missingCollectionIds: string[];
    };

export interface RecommendationAccessRequest {
  /** Alcance efectivo heredado del `Insight` de origen. */
  effectiveCollectionScope: string[];
  /** Colecciones que el consumidor tiene concedidas. */
  allowedCollectionIds: string[];
}

export function evaluateRecommendationAccess(
  request: RecommendationAccessRequest,
): RecommendationAccessDecision {
  const scope = [...new Set(request.effectiveCollectionScope)];

  if (scope.length === 0) {
    return {
      allowed: false,
      reason: 'EMPTY_SCOPE',
      explanation:
        'La recomendación no declara alcance de colección: su evidencia no pertenece a ' +
        'ninguna colección o no resuelve, y sin alcance no es accesible por defecto',
      missingCollectionIds: [],
    };
  }

  const allowed = new Set(request.allowedCollectionIds);
  const missingCollectionIds = scope.filter(
    (collectionId) => !allowed.has(collectionId),
  );

  if (missingCollectionIds.length > 0) {
    return {
      allowed: false,
      reason: 'SCOPE_NOT_COVERED',
      explanation:
        'La recomendación se apoya en colecciones a las que no tienes acceso concedido. ' +
        'La cobertura debe ser completa: el acceso parcial deniega',
      missingCollectionIds,
    };
  }

  return { allowed: true };
}

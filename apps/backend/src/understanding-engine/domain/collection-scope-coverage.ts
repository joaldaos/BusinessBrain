/**
 * Regla de cobertura de alcance de colección — UNDERSTANDING_ENGINE_DESIGN.md §3.4, §12.
 *
 * **Definición canónica y única.** Es la regla que decide si un consumidor puede acceder a
 * algo derivado de evidencia acotada: un `Insight` o una `Recommendation` escalada de él.
 *
 * Vive en el dominio del Understanding Engine porque `EffectiveCollectionScope` es un
 * concepto suyo (§3.4), no del módulo que lo consume. `RecommendationsModule` delega aquí, y
 * esa dirección —Understanding → Recommendations— es la del resto de la arquitectura. Tener
 * dos definiciones de esta regla significaría que una misma conclusión restringida se vuelve
 * visible o no según por qué puerta se entre, que es exactamente el fallo que la regla existe
 * para impedir.
 *
 * Dominio puro: sin base de datos, sin red, determinista.
 *
 * Dos invariantes, ambas fail-closed:
 *
 * 1. **Cobertura COMPLETA.** El acceso parcial deniega; nunca concede parcialmente. Ver la
 *    mitad de la evidencia no da derecho a ver la conclusión: lo que hace sensible una
 *    conclusión es precisamente la combinación de lo que la sostiene.
 * 2. **Alcance vacío = inaccesible.** Evidencia sin colección o irresoluble. Tratarla como
 *    "sin restricciones" convertiría el fallo más silencioso en acceso universal.
 */

export type ScopeCoverageDenialReason = 'EMPTY_SCOPE' | 'SCOPE_NOT_COVERED';

export type ScopeCoverageDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: ScopeCoverageDenialReason;
      explanation: string;
      /** Colecciones del alcance que el consumidor NO cubre. */
      missingCollectionIds: string[];
    };

export interface ScopeCoverageRequest {
  /** Alcance efectivo de lo que se quiere acceder. */
  effectiveCollectionScope: string[];
  /** Colecciones que el consumidor tiene concedidas. */
  allowedCollectionIds: string[];
}

export function evaluateCollectionScopeCoverage(
  request: ScopeCoverageRequest,
): ScopeCoverageDecision {
  const scope = [...new Set(request.effectiveCollectionScope)];

  if (scope.length === 0) {
    return {
      allowed: false,
      reason: 'EMPTY_SCOPE',
      explanation:
        'No declara alcance de colección: su evidencia no pertenece a ninguna colección o ' +
        'no resuelve, y sin alcance no es accesible por defecto',
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
        'Se apoya en colecciones a las que no tienes acceso concedido. La cobertura debe ' +
        'ser completa: el acceso parcial deniega',
      missingCollectionIds,
    };
  }

  return { allowed: true };
}

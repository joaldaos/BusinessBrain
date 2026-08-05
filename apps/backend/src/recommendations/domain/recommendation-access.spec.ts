import { evaluateRecommendationAccess } from './recommendation-access';

/**
 * Subfase 5.8 — regla de acceso a una `Recommendation`.
 *
 * Es la MISMA regla de cobertura completa que aplica `RetrieveInsights` (§3.4, §12). Se
 * prueba aquí de forma aislada porque es lo único que separa una propuesta sostenida por
 * evidencia restringida de que la vea cualquiera con acceso a las recomendaciones de la
 * organización.
 */
describe('evaluateRecommendationAccess', () => {
  const evaluate = (
    effectiveCollectionScope: string[],
    allowedCollectionIds: string[],
  ) =>
    evaluateRecommendationAccess({
      effectiveCollectionScope,
      allowedCollectionIds,
    });

  describe('cobertura completa', () => {
    it('permite cuando el consumidor cubre TODO el alcance', () => {
      expect(evaluate(['ventas', 'soporte'], ['ventas', 'soporte'])).toEqual({
        allowed: true,
      });
    });

    it('permite cuando el consumidor cubre de más', () => {
      expect(evaluate(['ventas'], ['ventas', 'soporte', 'rrhh'])).toEqual({
        allowed: true,
      });
    });

    it('el orden del alcance es irrelevante', () => {
      expect(evaluate(['soporte', 'ventas'], ['ventas', 'soporte'])).toEqual({
        allowed: true,
      });
    });

    it('un alcance con duplicados no cambia la decisión', () => {
      expect(evaluate(['ventas', 'ventas'], ['ventas'])).toEqual({
        allowed: true,
      });
    });
  });

  describe('acceso parcial', () => {
    it('DENIEGA cuando falta una sola colección del alcance', () => {
      // Ver la mitad de la evidencia no da derecho a ver la conclusión: lo que hace
      // sensible una propuesta es justamente la combinación de lo que la sostiene.
      const decision = evaluate(['ventas', 'rrhh'], ['ventas']);

      expect(decision.allowed).toBe(false);
      expect(decision.allowed === false && decision.reason).toBe(
        'SCOPE_NOT_COVERED',
      );
    });

    it('informa de QUÉ colecciones faltan, no solo de que faltan', () => {
      const decision = evaluate(['ventas', 'rrhh', 'legal'], ['ventas']);

      expect(
        decision.allowed === false && decision.missingCollectionIds,
      ).toEqual(['rrhh', 'legal']);
    });

    it('DENIEGA a quien no tiene ninguna colección concedida', () => {
      const decision = evaluate(['ventas'], []);

      expect(decision.allowed === false && decision.reason).toBe(
        'SCOPE_NOT_COVERED',
      );
    });

    it('DENIEGA aunque el consumidor tenga muchas colecciones, si no son las del alcance', () => {
      const decision = evaluate(['legal'], ['ventas', 'soporte', 'marketing']);

      expect(decision.allowed).toBe(false);
    });
  });

  describe('alcance vacío', () => {
    it('DENIEGA un alcance vacío aunque el consumidor lo tenga todo', () => {
      // Tratar "sin alcance" como "sin restricciones" convertiría el fallo más silencioso
      // —evidencia huérfana— en acceso universal.
      const decision = evaluate([], ['ventas', 'rrhh', 'legal']);

      expect(decision.allowed).toBe(false);
      expect(decision.allowed === false && decision.reason).toBe('EMPTY_SCOPE');
    });

    it('DENIEGA un alcance vacío frente a un consumidor vacío', () => {
      expect(evaluate([], []).allowed).toBe(false);
    });
  });
});

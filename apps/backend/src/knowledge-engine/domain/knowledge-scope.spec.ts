import {
  ORGANIZATION_WIDE_REASONS,
  collectionsScope,
  isEmptyScope,
  organizationWideScope,
  scopeFilter,
} from './knowledge-scope';

/**
 * Subfase 6.3 — alcance obligatorio.
 *
 * Lo que se prueba aquí es la distinción que antes no existía: "sin colecciones concedidas"
 * y "sin filtro" eran el mismo valor, y por eso un descuido devolvía toda la organización.
 */
describe('KnowledgeScope', () => {
  describe('acceso a NADA frente a acceso a TODO', () => {
    it('un alcance de colecciones VACÍO no puede devolver nada', () => {
      const scope = collectionsScope([]);

      expect(isEmptyScope(scope)).toBe(true);
      // La clave: filtrar por lista vacía, NO ausencia de filtro.
      expect(scopeFilter(scope)).toEqual([]);
      expect(scopeFilter(scope)).not.toBeNull();
    });

    it('el alcance de organización completa es el ÚNICO que no filtra', () => {
      const scope = organizationWideScope(
        ORGANIZATION_WIDE_REASONS.ANALYSIS_REASONING,
      );

      expect(isEmptyScope(scope)).toBe(false);
      expect(scopeFilter(scope)).toBeNull();
    });

    it('un alcance con colecciones filtra por ellas', () => {
      expect(scopeFilter(collectionsScope(['ventas', 'rrhh']))).toEqual([
        'ventas',
        'rrhh',
      ]);
    });
  });

  describe('normalización', () => {
    it('elimina duplicados: conceder dos veces no amplía nada', () => {
      expect(scopeFilter(collectionsScope(['a', 'a', 'b']))).toEqual([
        'a',
        'b',
      ]);
    });

    it('el alcance de organización completa exige un motivo del catálogo', () => {
      const scope = organizationWideScope(
        ORGANIZATION_WIDE_REASONS.ANALYSIS_REASONING,
      );

      expect(scope.mode === 'ORGANIZATION_WIDE' && scope.reason).toContain(
        '§3.4',
      );
    });
  });
});

import { InsightType } from '@businessbrain/database';
import {
  CONTRADICTION_PENALTY,
  CORROBORATION_BOOST,
  resolveInsightConflict,
  type ConflictParty,
} from './resolve-insight-conflict';

/**
 * `ResolveInsightConflict` — UNDERSTANDING_ENGINE_DESIGN.md §12, §9.
 *
 * El foco de estos tests es la regla de independencia: dos afirmaciones que convergen solo
 * porque dependen de la misma fuente NO pueden subir la confianza. Sin esa comprobación,
 * la confianza de una fuente débil se "lavaría" por convergencia aparente.
 */
describe('resolveInsightConflict (§12, §9)', () => {
  const party = (overrides: Partial<ConflictParty> = {}): ConflictParty => ({
    type: overrides.type ?? InsightType.ANOMALY,
    confidence: overrides.confidence ?? 0.8,
    evidenceRefIds: overrides.evidenceRefIds ?? ['ev-1'],
    strategyKey: overrides.strategyKey ?? 'estrategia-a',
  });

  describe('corroboración independiente', () => {
    it('dos estrategias distintas sin evidencia compartida SUBEN la confianza', () => {
      const result = resolveInsightConflict(
        party({ strategyKey: 'simbolica', evidenceRefIds: ['ev-1'] }),
        party({ strategyKey: 'generativa', evidenceRefIds: ['ev-2'] }),
      );

      expect(result.outcome).toBe('CORROBORATED');
      expect(result.resolvedConfidence).toBeCloseTo(
        0.8 + CORROBORATION_BOOST,
        4,
      );
      expect(result.sharedEvidenceRefIds).toEqual([]);
    });

    it('la confianza nunca supera 1', () => {
      const result = resolveInsightConflict(
        party({ confidence: 0.99, strategyKey: 'a', evidenceRefIds: ['x'] }),
        party({ strategyKey: 'b', evidenceRefIds: ['y'] }),
      );

      expect(result.resolvedConfidence).toBeLessThanOrEqual(1);
    });
  });

  describe('regla de independencia (§9)', () => {
    it('NO sube la confianza si las cadenas comparten evidencia', () => {
      // Ambas dependen de la misma fuente: convergencia aparente, no evidencia nueva.
      const result = resolveInsightConflict(
        party({ strategyKey: 'simbolica', evidenceRefIds: ['comun', 'a'] }),
        party({ strategyKey: 'generativa', evidenceRefIds: ['comun', 'b'] }),
      );

      expect(result.outcome).toBe('NOT_INDEPENDENT');
      expect(result.resolvedConfidence).toBe(0.8);
      expect(result.sharedEvidenceRefIds).toEqual(['comun']);
    });

    it('NO sube la confianza si ambas proceden de la MISMA estrategia', () => {
      // Repetir el mismo mecanismo no aporta evidencia independiente.
      const result = resolveInsightConflict(
        party({ strategyKey: 'simbolica', evidenceRefIds: ['a'] }),
        party({ strategyKey: 'simbolica', evidenceRefIds: ['b'] }),
      );

      expect(result.outcome).toBe('NOT_INDEPENDENT');
      expect(result.resolvedConfidence).toBe(0.8);
    });

    it('explica por qué no contó como corroboración', () => {
      const result = resolveInsightConflict(
        party({ strategyKey: 'a', evidenceRefIds: ['comun'] }),
        party({ strategyKey: 'b', evidenceRefIds: ['comun'] }),
      );

      expect(result.rationale).toMatch(/misma fuente|independiente/i);
    });
  });

  describe('contradicción', () => {
    it('tipos distintos sobre el mismo asunto BAJAN la confianza', () => {
      const result = resolveInsightConflict(
        party({
          type: InsightType.PATTERN,
          strategyKey: 'a',
          evidenceRefIds: ['x'],
        }),
        party({
          type: InsightType.ANOMALY,
          strategyKey: 'b',
          evidenceRefIds: ['y'],
        }),
      );

      expect(result.outcome).toBe('CONTRADICTED');
      expect(result.resolvedConfidence).toBeCloseTo(
        0.8 - CONTRADICTION_PENALTY,
        4,
      );
    });

    it('una contradicción NUNCA se ignora, aunque las cadenas no sean independientes', () => {
      // La discrepancia es información en sí misma: se registra igualmente (§9).
      const result = resolveInsightConflict(
        party({
          type: InsightType.PATTERN,
          strategyKey: 'misma',
          evidenceRefIds: ['c'],
        }),
        party({
          type: InsightType.RISK,
          strategyKey: 'misma',
          evidenceRefIds: ['c'],
        }),
      );

      expect(result.outcome).toBe('CONTRADICTED');
      expect(result.resolvedConfidence).toBeLessThan(0.8);
    });

    it('la confianza nunca baja de 0', () => {
      const result = resolveInsightConflict(
        party({ type: InsightType.PATTERN, confidence: 0.02 }),
        party({ type: InsightType.ANOMALY }),
      );

      expect(result.resolvedConfidence).toBeGreaterThanOrEqual(0);
    });
  });

  it('la decisión siempre se explica (§10)', () => {
    const cases = [
      resolveInsightConflict(
        party({ strategyKey: 'a', evidenceRefIds: ['x'] }),
        party({ strategyKey: 'b', evidenceRefIds: ['y'] }),
      ),
      resolveInsightConflict(
        party({ strategyKey: 'a', evidenceRefIds: ['c'] }),
        party({ strategyKey: 'b', evidenceRefIds: ['c'] }),
      ),
      resolveInsightConflict(
        party({ type: InsightType.PATTERN }),
        party({ type: InsightType.ANOMALY }),
      ),
    ];

    for (const result of cases) {
      expect(result.rationale.length).toBeGreaterThan(0);
    }
  });

  it('es determinista: la misma entrada produce la misma resolución', () => {
    const a = party({ strategyKey: 'a', evidenceRefIds: ['x'] });
    const b = party({ strategyKey: 'b', evidenceRefIds: ['y'] });

    expect(resolveInsightConflict(a, b)).toEqual(resolveInsightConflict(a, b));
  });
});

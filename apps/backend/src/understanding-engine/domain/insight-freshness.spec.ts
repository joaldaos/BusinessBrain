import {
  DEFAULT_INSIGHT_CONFIDENCE_FLOOR,
  DEFAULT_INSIGHT_HALF_LIFE_DAYS,
  applyInsightDecay,
  evaluateFreshness,
  type EvidenceState,
} from './insight-freshness';

/**
 * Criterio de aceptación de la subfase 3.4 (UNDERSTANDING_ENGINE_DESIGN.md §17):
 * "un Insight sin recorroboración pierde confianza según lo esperado; un cambio en su
 * evidencia hace que se lea como no fresco AUNQUE LA SEÑAL DE RECÁLCULO SE SUPRIMA
 * deliberadamente en la prueba — comprobando que la corrección no depende de la propagación".
 */
describe('evaluateFreshness (§3.4)', () => {
  const computedAt = new Date('2026-06-01T00:00:00Z');
  const before = new Date('2026-05-01T00:00:00Z');
  const after = new Date('2026-07-01T00:00:00Z');

  const evidence = (
    refId: string,
    overrides: Partial<EvidenceState> = {},
  ): EvidenceState => ({
    refId,
    lastChangedAt: overrides.lastChangedAt ?? before,
    unresolvable: overrides.unresolvable ?? false,
  });

  it('es FRESH cuando ninguna evidencia cambió desde el cálculo', () => {
    const result = evaluateFreshness({
      computedAt,
      evidenceStates: [evidence('a'), evidence('b')],
    });

    expect(result.freshness).toBe('FRESH');
    expect(result.changedRefIds).toEqual([]);
  });

  it('es STALE en cuanto una evidencia cambió, SIN NINGUNA señal de recálculo', () => {
    // La garantía central: la corrección NO depende de que ninguna cascada asíncrona
    // llegue. Aquí no hay propagación de ningún tipo y aun así se detecta.
    const result = evaluateFreshness({
      computedAt,
      evidenceStates: [evidence('a'), evidence('b', { lastChangedAt: after })],
    });

    expect(result.freshness).toBe('STALE');
    expect(result.changedRefIds).toEqual(['b']);
  });

  it('es UNRESOLVABLE si alguna evidencia dejó de existir (purga, descarte)', () => {
    const result = evaluateFreshness({
      computedAt,
      evidenceStates: [evidence('a'), evidence('b', { unresolvable: true })],
    });

    expect(result.freshness).toBe('UNRESOLVABLE');
    expect(result.unresolvableRefIds).toEqual(['b']);
  });

  it('la irresolubilidad domina sobre el mero cambio: es la condición más grave', () => {
    const result = evaluateFreshness({
      computedAt,
      evidenceStates: [
        evidence('a', { lastChangedAt: after }),
        evidence('b', { unresolvable: true }),
      ],
    });

    expect(result.freshness).toBe('UNRESOLVABLE');
  });

  it('un cambio ANTERIOR al cálculo no lo hace obsoleto', () => {
    // El Insight ya conocía ese estado cuando se calculó.
    const result = evaluateFreshness({
      computedAt,
      evidenceStates: [evidence('a', { lastChangedAt: before })],
    });

    expect(result.freshness).toBe('FRESH');
  });

  it('una evidencia cuyo estado no se pudo resolver NO se asume intacta', () => {
    const result = evaluateFreshness({
      computedAt,
      evidenceStates: [
        evidence('a', { lastChangedAt: null, unresolvable: true }),
      ],
    });

    expect(result.freshness).toBe('UNRESOLVABLE');
  });

  it('un Insight sin evidencia se considera fresco: no hay nada que pueda cambiar', () => {
    expect(
      evaluateFreshness({ computedAt, evidenceStates: [] }).freshness,
    ).toBe('FRESH');
  });

  it('siempre explica su porqué (§10)', () => {
    const results = [
      evaluateFreshness({ computedAt, evidenceStates: [evidence('a')] }),
      evaluateFreshness({
        computedAt,
        evidenceStates: [evidence('a', { lastChangedAt: after })],
      }),
      evaluateFreshness({
        computedAt,
        evidenceStates: [evidence('a', { unresolvable: true })],
      }),
    ];

    for (const result of results) {
      expect(result.rationale.length).toBeGreaterThan(0);
    }
  });

  it('es determinista y pura: no lee reloj ni estado externo', () => {
    const input = { computedAt, evidenceStates: [evidence('a')] };
    expect(evaluateFreshness(input)).toEqual(evaluateFreshness(input));
  });
});

describe('applyInsightDecay (§9)', () => {
  const computedAt = new Date('2026-01-01T00:00:00Z');
  const daysLater = (n: number) =>
    new Date(computedAt.getTime() + n * 86_400_000);

  it('un Insight sin recorroboración pierde confianza con el tiempo', () => {
    const initial = 0.9;
    const decayed = applyInsightDecay({
      currentConfidence: initial,
      computedAt,
      now: daysLater(90),
      type: 'ANOMALY',
    });

    expect(decayed).toBeLessThan(initial);
  });

  it('una anomalía puntual envejece más rápido que un patrón sostenido', () => {
    const anomaly = applyInsightDecay({
      currentConfidence: 0.9,
      computedAt,
      now: daysLater(60),
      type: 'ANOMALY',
    });
    const pattern = applyInsightDecay({
      currentConfidence: 0.9,
      computedAt,
      now: daysLater(60),
      type: 'PATTERN',
    });

    expect(DEFAULT_INSIGHT_HALF_LIFE_DAYS.ANOMALY).toBeLessThan(
      DEFAULT_INSIGHT_HALF_LIFE_DAYS.PATTERN,
    );
    expect(anomaly).toBeLessThan(pattern);
  });

  it('NUNCA baja del piso, ni tras décadas', () => {
    const decayed = applyInsightDecay({
      currentConfidence: 0.9,
      computedAt,
      now: daysLater(365 * 30),
      type: 'ANOMALY',
    });

    expect(decayed).toBeGreaterThanOrEqual(DEFAULT_INSIGHT_CONFIDENCE_FLOOR);
  });

  it('un Insight ya en el piso no se degrada más', () => {
    expect(
      applyInsightDecay({
        currentConfidence: DEFAULT_INSIGHT_CONFIDENCE_FLOOR,
        computedAt,
        now: daysLater(1000),
        type: 'ANOMALY',
      }),
    ).toBe(DEFAULT_INSIGHT_CONFIDENCE_FLOOR);
  });

  it('sin tiempo transcurrido no degrada', () => {
    expect(
      applyInsightDecay({
        currentConfidence: 0.9,
        computedAt,
        now: computedAt,
        type: 'ANOMALY',
      }),
    ).toBeCloseTo(0.9, 4);
  });

  it('se calcula siempre desde computedAt: repetirlo no degrada dos veces', () => {
    const once = applyInsightDecay({
      currentConfidence: 0.9,
      computedAt,
      now: daysLater(45),
      type: 'PATTERN',
    });
    const twice = applyInsightDecay({
      currentConfidence: 0.9,
      computedAt,
      now: daysLater(45),
      type: 'PATTERN',
    });

    expect(twice).toBe(once);
  });

  it('un tipo desconocido usa una vida media de respaldo en vez de fallar', () => {
    const decayed = applyInsightDecay({
      currentConfidence: 0.8,
      computedAt,
      now: daysLater(30),
      type: 'TIPO_FUTURO',
    });

    expect(Number.isFinite(decayed)).toBe(true);
    expect(decayed).toBeLessThan(0.8);
  });
});

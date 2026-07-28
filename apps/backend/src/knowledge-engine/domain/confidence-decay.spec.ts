import { AgentArea } from '@businessbrain/database';
import {
  DEFAULT_DECAY_SETTINGS,
  DEFAULT_MINIMUM_CONFIDENCE_FLOOR,
  applyTemporalDecay,
  getDecaySettings,
} from './confidence-decay';

/**
 * Criterio de aceptación de la subfase 2.4 (KNOWLEDGE_ENGINE_DESIGN.md §19):
 * "el score de un ítem sin actividad baja con el tiempo según lo esperado".
 */
describe('applyTemporalDecay (§8.3)', () => {
  const computedAt = new Date('2026-01-01T00:00:00Z');
  const daysLater = (n: number) =>
    new Date(computedAt.getTime() + n * 86_400_000);

  const base = {
    currentScore: 0.9,
    computedAt,
    businessArea: AgentArea.GENERAL,
    sourceInactive: false,
  };

  it('no degrada nada si no ha pasado tiempo', () => {
    const { score } = applyTemporalDecay({ ...base, now: computedAt });
    expect(score).toBeCloseTo(0.9, 4);
  });

  it('el score baja de forma monótona con el tiempo', () => {
    const scores = [0, 30, 90, 180, 365, 730].map(
      (d) => applyTemporalDecay({ ...base, now: daysLater(d) }).score,
    );

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  it('tras una vida media recorre la mitad de la distancia hasta el piso', () => {
    const halfLife = DEFAULT_DECAY_SETTINGS.halfLifeDaysByArea.GENERAL;
    const { score, floor } = applyTemporalDecay({
      ...base,
      now: daysLater(halfLife),
    });

    const expected = floor + (0.9 - floor) / 2;
    expect(score).toBeCloseTo(expected, 3);
  });

  it('NUNCA baja del piso mínimo, ni siquiera tras décadas (§8.3)', () => {
    const { score, floor } = applyTemporalDecay({
      ...base,
      now: daysLater(365 * 50),
    });

    expect(score).toBeGreaterThanOrEqual(floor);
    expect(floor).toBe(DEFAULT_MINIMUM_CONFIDENCE_FLOOR);
  });

  it('un ítem ya en el piso no se degrada más', () => {
    const atFloor = applyTemporalDecay({
      ...base,
      currentScore: DEFAULT_MINIMUM_CONFIDENCE_FLOOR,
      now: daysLater(1000),
    });

    expect(atFloor.score).toBe(DEFAULT_MINIMUM_CONFIDENCE_FLOOR);
  });

  it('una política de RR. HH. envejece más lento que contenido de marketing (§8.3)', () => {
    const hr = applyTemporalDecay({
      ...base,
      businessArea: AgentArea.HR,
      now: daysLater(180),
    });
    const marketing = applyTemporalDecay({
      ...base,
      businessArea: AgentArea.MARKETING,
      now: daysLater(180),
    });

    expect(hr.score).toBeGreaterThan(marketing.score);
  });

  it('un ítem sin clasificar usa la vida media de respaldo, no falla', () => {
    const result = applyTemporalDecay({
      ...base,
      businessArea: null,
      now: daysLater(180),
    });

    expect(result.halfLifeDays).toBe(
      DEFAULT_DECAY_SETTINGS.unclassifiedHalfLifeDays,
    );
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('una fuente inactiva envejece su conocimiento con más severidad (§8.2)', () => {
    const active = applyTemporalDecay({ ...base, now: daysLater(180) });
    const inactive = applyTemporalDecay({
      ...base,
      sourceInactive: true,
      now: daysLater(180),
    });

    expect(inactive.score).toBeLessThan(active.score);
    expect(inactive.halfLifeDays).toBeLessThan(active.halfLifeDays);
  });

  it('es una función pura: no depende del reloj real ni acumula efecto', () => {
    const a = applyTemporalDecay({ ...base, now: daysLater(100) });
    const b = applyTemporalDecay({ ...base, now: daysLater(100) });

    expect(a).toEqual(b);
  });

  it('recalcular desde el mismo origen dos veces no degrada dos veces', () => {
    // El decaimiento se calcula SIEMPRE desde computedAt, no como decremento acumulativo:
    // por eso el barrido puede repetirse sin castigar de más al ítem.
    const once = applyTemporalDecay({ ...base, now: daysLater(90) });
    const twice = applyTemporalDecay({ ...base, now: daysLater(90) });

    expect(twice.score).toBe(once.score);
  });
});

describe('getDecaySettings (§8.3, umbrales como configuración)', () => {
  it('usa los valores de plataforma cuando la organización no configura nada', () => {
    expect(getDecaySettings(null)).toEqual(DEFAULT_DECAY_SETTINGS);
    expect(getDecaySettings({})).toEqual(DEFAULT_DECAY_SETTINGS);
  });

  it('respeta la configuración válida de la organización', () => {
    const settings = getDecaySettings({
      knowledgeEngine: {
        confidence: { halfLifeDaysByArea: { HR: 900 }, minimumFloor: 0.35 },
      },
    });

    expect(settings.halfLifeDaysByArea.HR).toBe(900);
    expect(settings.minimumFloor).toBe(0.35);
    // Las áreas no configuradas conservan el valor de plataforma.
    expect(settings.halfLifeDaysByArea.MARKETING).toBe(
      DEFAULT_DECAY_SETTINGS.halfLifeDaysByArea.MARKETING,
    );
  });

  it('ignora configuración inválida: nunca puede desactivar el piso de confianza', () => {
    const settings = getDecaySettings({
      knowledgeEngine: {
        confidence: {
          minimumFloor: 5,
          halfLifeDaysByArea: { HR: -10 },
          inactiveSourceMultiplier: 0.1,
        },
      },
    });

    expect(settings.minimumFloor).toBe(DEFAULT_MINIMUM_CONFIDENCE_FLOOR);
    expect(settings.halfLifeDaysByArea.HR).toBe(
      DEFAULT_DECAY_SETTINGS.halfLifeDaysByArea.HR,
    );
    expect(settings.inactiveSourceMultiplier).toBe(
      DEFAULT_DECAY_SETTINGS.inactiveSourceMultiplier,
    );
  });
});

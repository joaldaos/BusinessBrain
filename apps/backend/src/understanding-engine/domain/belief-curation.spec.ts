import {
  MAX_CURATION_LOOKBACK,
  authorizesEscalation,
  resolveEffectiveCuration,
  resolveOwnCuration,
  type CuratedVersion,
  type CurationEntry,
} from './belief-curation';

/**
 * Fase 7.1 — la decisión humana sobrevive a que la máquina cambie de opinión.
 *
 * Lo que se prueba: que la prioridad de §3.7 se conserve al versionar, que jamás se presente
 * una curación heredada como si se hubiera emitido sobre la versión actual, y que la herencia
 * se corte donde debe.
 */
const feedback = (
  id: string,
  overrides: Partial<CurationEntry> = {},
): CurationEntry => ({
  id,
  type: 'CONFIRMATION',
  comment: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  revokesFeedbackId: null,
  ...overrides,
});

const version = (
  id: string,
  overrides: Partial<CuratedVersion> = {},
): CuratedVersion => ({
  id,
  status: 'ACTIVE',
  supersedesInsightId: null,
  feedback: [],
  reconciliationOutcome: null,
  ...overrides,
});

const chainOf = (...versions: CuratedVersion[]) =>
  new Map(versions.map((v) => [v.id, v]));

describe('resolveOwnCuration', () => {
  it('sin curación no inventa ninguna', () => {
    expect(resolveOwnCuration([])).toBeNull();
  });

  it('devuelve la más reciente no revocada', () => {
    const antigua = feedback('f1', {
      createdAt: new Date('2026-01-01'),
      comment: 'primera',
    });
    const reciente = feedback('f2', {
      createdAt: new Date('2026-03-01'),
      comment: 'segunda',
    });

    expect(resolveOwnCuration([antigua, reciente])?.comment).toBe('segunda');
  });

  it('una entrada revocada deja de estar vigente', () => {
    const original = feedback('f1');
    const revocacion = feedback('f2', {
      type: 'REVOCATION',
      createdAt: new Date('2026-02-01'),
      revokesFeedbackId: 'f1',
    });

    expect(resolveOwnCuration([original, revocacion])).toBeNull();
  });

  it('revocar la última deja vigente la anterior, no un vacío', () => {
    const primera = feedback('f1', { createdAt: new Date('2026-01-01') });
    const segunda = feedback('f2', {
      createdAt: new Date('2026-02-01'),
      comment: 'la segunda',
    });
    const revocaLaSegunda = feedback('f3', {
      type: 'REVOCATION',
      createdAt: new Date('2026-03-01'),
      revokesFeedbackId: 'f2',
    });

    // El registro es de solo-anexado: revocar no borra, y lo anterior sigue en pie.
    expect(resolveOwnCuration([primera, segunda, revocaLaSegunda])?.id).toBe(
      'f1',
    );
  });
});

describe('resolveEffectiveCuration', () => {
  it('la curación propia se declara como propia y nunca en disputa', () => {
    const v1 = version('v1', { feedback: [feedback('f1')] });

    const result = resolveEffectiveCuration('v1', chainOf(v1));

    expect(result).toMatchObject({
      origin: 'OWN',
      curatedVersionId: 'v1',
      disputed: false,
    });
  });

  it('CRÍTICO: la sucesora HEREDA la curación de la versión superada', () => {
    // Es el defecto que esta subfase corrige: antes, versionar dejaba la creencia viva sin
    // curación y el decaimiento automático volvía a gobernarla.
    const v1 = version('v1', {
      status: 'SUPERSEDED',
      feedback: [feedback('f1', { comment: 'confirmado por una persona' })],
    });
    const v2 = version('v2', { supersedesInsightId: 'v1' });

    const result = resolveEffectiveCuration('v2', chainOf(v1, v2));

    expect(result).toMatchObject({
      type: 'CONFIRMATION',
      comment: 'confirmado por una persona',
      origin: 'INHERITED',
      // Se dice sobre QUÉ versión se pronunció realmente la persona.
      curatedVersionId: 'v1',
      disputed: false,
    });
  });

  it('hereda a través de varias versiones sin curación intermedia', () => {
    const v1 = version('v1', {
      status: 'SUPERSEDED',
      feedback: [feedback('f1')],
    });
    const v2 = version('v2', {
      status: 'SUPERSEDED',
      supersedesInsightId: 'v1',
    });
    const v3 = version('v3', { supersedesInsightId: 'v2' });

    expect(resolveEffectiveCuration('v3', chainOf(v1, v2, v3))).toMatchObject({
      origin: 'INHERITED',
      curatedVersionId: 'v1',
    });
  });

  it('la curación PROPIA gana sobre la heredable', () => {
    const v1 = version('v1', {
      status: 'SUPERSEDED',
      feedback: [feedback('f1', { comment: 'la vieja' })],
    });
    const v2 = version('v2', {
      supersedesInsightId: 'v1',
      feedback: [feedback('f2', { comment: 'la de esta versión' })],
    });

    expect(resolveEffectiveCuration('v2', chainOf(v1, v2))).toMatchObject({
      comment: 'la de esta versión',
      origin: 'OWN',
    });
  });

  it('una curación revocada no se hereda', () => {
    const v1 = version('v1', {
      status: 'SUPERSEDED',
      feedback: [
        feedback('f1'),
        feedback('f2', {
          type: 'REVOCATION',
          createdAt: new Date('2026-02-01'),
          revokesFeedbackId: 'f1',
        }),
      ],
    });
    const v2 = version('v2', { supersedesInsightId: 'v1' });

    expect(resolveEffectiveCuration('v2', chainOf(v1, v2))).toBeNull();
  });

  describe('en disputa', () => {
    it('una transición CONTRADICTED marca la curación heredada como disputada', () => {
      const v1 = version('v1', {
        status: 'SUPERSEDED',
        feedback: [feedback('f1')],
      });
      // La evidencia nueva discrepa de lo que la persona confirmó.
      const v2 = version('v2', {
        supersedesInsightId: 'v1',
        reconciliationOutcome: 'CONTRADICTED',
      });

      expect(resolveEffectiveCuration('v2', chainOf(v1, v2))).toMatchObject({
        origin: 'INHERITED',
        disputed: true,
      });
    });

    it('una corroboración NO pone la curación en disputa', () => {
      const v1 = version('v1', {
        status: 'SUPERSEDED',
        feedback: [feedback('f1')],
      });
      const v2 = version('v2', {
        supersedesInsightId: 'v1',
        reconciliationOutcome: 'CORROBORATED',
      });

      expect(resolveEffectiveCuration('v2', chainOf(v1, v2))).toMatchObject({
        disputed: false,
      });
    });

    it('una contradicción en CUALQUIER punto del trayecto la deja en disputa', () => {
      const v1 = version('v1', {
        status: 'SUPERSEDED',
        feedback: [feedback('f1')],
      });
      const v2 = version('v2', {
        status: 'SUPERSEDED',
        supersedesInsightId: 'v1',
        reconciliationOutcome: 'CONTRADICTED',
      });
      const v3 = version('v3', {
        supersedesInsightId: 'v2',
        reconciliationOutcome: 'CORROBORATED',
      });

      // La corroboración posterior no borra que hubo una contradicción por el camino.
      expect(resolveEffectiveCuration('v3', chainOf(v1, v2, v3))).toMatchObject(
        { disputed: true },
      );
    });

    it('una curación PROPIA nunca está en disputa aunque la transición contradijera', () => {
      const v1 = version('v1', { status: 'SUPERSEDED' });
      const v2 = version('v2', {
        supersedesInsightId: 'v1',
        reconciliationOutcome: 'CONTRADICTED',
        feedback: [feedback('f1')],
      });

      // La persona se pronunció DESPUÉS de la contradicción, sobre esta misma versión.
      expect(resolveEffectiveCuration('v2', chainOf(v1, v2))).toMatchObject({
        origin: 'OWN',
        disputed: false,
      });
    });
  });

  describe('la herencia se corta donde debe', () => {
    it('NO se hereda a través de un DISCARDED', () => {
      const v1 = version('v1', {
        status: 'SUPERSEDED',
        feedback: [feedback('f1')],
      });
      // Alguien descartó el asunto por el camino.
      const v2 = version('v2', {
        status: 'DISCARDED',
        supersedesInsightId: 'v1',
      });
      const v3 = version('v3', { supersedesInsightId: 'v2' });

      expect(resolveEffectiveCuration('v3', chainOf(v1, v2, v3))).toBeNull();
    });

    it('una cadena incompleta corta la herencia en vez de adivinar', () => {
      // Al paginar o al leer parcialmente, la predecesora puede no estar disponible.
      const v2 = version('v2', { supersedesInsightId: 'v1-no-cargada' });

      expect(resolveEffectiveCuration('v2', chainOf(v2))).toBeNull();
    });

    it('la raíz sin curación no hereda de la nada', () => {
      expect(resolveEffectiveCuration('v1', chainOf(version('v1')))).toBeNull();
    });

    it('una cadena más larga que la cota deja de heredar', () => {
      const versions: CuratedVersion[] = [
        version('v0', { feedback: [feedback('f1')] }),
      ];
      for (let index = 1; index <= MAX_CURATION_LOOKBACK + 5; index += 1) {
        versions.push(
          version(`v${index}`, { supersedesInsightId: `v${index - 1}` }),
        );
      }

      const ultima = versions[versions.length - 1].id;
      expect(resolveEffectiveCuration(ultima, chainOf(...versions))).toBeNull();
    });

    it('una versión desconocida no produce curación', () => {
      expect(resolveEffectiveCuration('no-existe', chainOf())).toBeNull();
    });
  });
});

describe('authorizesEscalation', () => {
  it('la curación PROPIA autoriza escalar', () => {
    expect(
      authorizesEscalation({
        type: 'CONFIRMATION',
        comment: null,
        at: new Date(),
        origin: 'OWN',
        curatedVersionId: 'v1',
        disputed: false,
      }),
    ).toBe(true);
  });

  it('la HEREDADA no autoriza: se validó otra afirmación, no esta', () => {
    expect(
      authorizesEscalation({
        type: 'CONFIRMATION',
        comment: null,
        at: new Date(),
        origin: 'INHERITED',
        curatedVersionId: 'v1',
        disputed: false,
      }),
    ).toBe(false);
  });

  it('sin curación no se escala', () => {
    expect(authorizesEscalation(null)).toBe(false);
  });
});

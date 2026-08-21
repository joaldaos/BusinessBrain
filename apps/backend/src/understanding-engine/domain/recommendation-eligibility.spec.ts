import {
  MINIMUM_CONFIDENCE,
  MINIMUM_EVIDENCE,
  evaluateEligibility,
  isPublishableProposal,
  type EligibilityInput,
  type ProposalDraft,
} from './recommendation-eligibility';

const elegible = (overrides: Partial<EligibilityInput> = {}) =>
  evaluateEligibility({
    status: 'ACTIVE',
    type: 'RISK',
    confidence: 0.8,
    evidenceCount: 3,
    effectiveCollectionScope: ['col-1'],
    alreadyProposed: false,
    ...overrides,
  });

describe('evaluateEligibility', () => {
  it('una conclusión sólida y accionable sí genera propuesta', () => {
    expect(elegible()).toEqual({ eligible: true });
  });

  describe('CRÍTICO: es preferible CERO recomendaciones a una falsa', () => {
    it('sin NINGUNA evidencia NO se propone nada: eso sería inventar', () => {
      expect(elegible({ evidenceCount: MINIMUM_EVIDENCE - 1 })).toMatchObject({
        eligible: false,
        reason: 'EVIDENCIA_INSUFICIENTE',
      });
      expect(elegible({ evidenceCount: 0 }).eligible).toBe(false);
    });

    it('UN documento basta cuando la afirmación va sobre ese documento', () => {
      // Exigir dos silenciaba lo más útil que el sistema sabe decir: "este contrato ha
      // perdido fiabilidad". Para una afirmación sobre un documento, ese documento es la
      // evidencia completa.
      expect(elegible({ evidenceCount: 1 }).eligible).toBe(true);
    });

    it('con confianza baja NO se propone nada', () => {
      // Por debajo del umbral el motor está diciendo que no las tiene todas consigo.
      expect(elegible({ confidence: MINIMUM_CONFIDENCE - 0.01 })).toMatchObject(
        { eligible: false, reason: 'CONFIANZA_INSUFICIENTE' },
      );
    });

    it('justo en el umbral SÍ entra: el límite es inclusivo y explícito', () => {
      expect(
        elegible({
          confidence: MINIMUM_CONFIDENCE,
          evidenceCount: MINIMUM_EVIDENCE,
        }).eligible,
      ).toBe(true);
    });
  });

  describe('conclusiones sobre las que no cabe actuar', () => {
    it.each([
      ['superada', 'SUPERSEDED'],
      ['descartada por una persona', 'DISCARDED'],
      ['expirada', 'EXPIRED'],
      ['todavía candidata', 'CANDIDATE'],
    ])('%s NO genera propuesta', (_caso, status) => {
      // Una propuesta sobre conocimiento obsoleto es peor que ninguna: parece vigente.
      expect(
        elegible({ status: status as EligibilityInput['status'] }),
      ).toMatchObject({ eligible: false, reason: 'ESTADO_NO_ACTIVO' });
    });

    it('un patrón solo dice "esto se repite": no hay nada que corregir', () => {
      expect(elegible({ type: 'PATTERN' })).toMatchObject({
        eligible: false,
        reason: 'TIPO_NO_ACCIONABLE',
      });
    });

    it.each([
      ['riesgo', 'RISK'],
      ['oportunidad', 'OPPORTUNITY'],
      // Una anomalía es una DESVIACIÓN, y sobre una desviación siempre cabe revisarla.
      // Excluirla dejaba la funcionalidad inalcanzable: la única estrategia determinista del
      // motor produce exclusivamente anomalías.
      ['anomalía', 'ANOMALY'],
    ])('%s sí articula una acción', (_caso, type) => {
      expect(
        elegible({ type: type as EligibilityInput['type'] }).eligible,
      ).toBe(true);
    });
  });

  it('CRÍTICO: sin alcance NO se propone — fail-closed', () => {
    // Sin colecciones nadie podría leerla: sería ruido invisible e inauditable.
    expect(elegible({ effectiveCollectionScope: [] })).toMatchObject({
      eligible: false,
      reason: 'SIN_ALCANCE',
    });
  });

  it('CRÍTICO: no se duplica una propuesta ya existente', () => {
    expect(elegible({ alreadyProposed: true })).toMatchObject({
      eligible: false,
      reason: 'YA_PROPUESTA',
    });
  });

  it('la duplicidad se comprueba ANTES que todo lo demás', () => {
    // Si ya hay una propuesta viva, da igual el resto: el motivo útil es que ya existe.
    expect(
      elegible({
        alreadyProposed: true,
        status: 'SUPERSEDED',
        confidence: 0.1,
      }).reason,
    ).toBe('YA_PROPUESTA');
  });

  it('cada rechazo se explica en lenguaje de negocio', () => {
    for (const decision of [
      elegible({ evidenceCount: 0 }),
      elegible({ confidence: 0.1 }),
      elegible({ status: 'SUPERSEDED' }),
      elegible({ type: 'PATTERN' }),
      elegible({ effectiveCollectionScope: [] }),
    ]) {
      expect(decision.explanation).toBeTruthy();
      expect(decision.explanation).not.toMatch(
        /Insight|null|undefined|Exception|[A-Z_]{6,}/,
      );
    }
  });
});

describe('isPublishableProposal', () => {
  const completa: ProposalDraft = {
    title: 'Revisar los descuentos del canal mayorista',
    detected:
      'Los descuentos aplicados superan el máximo autorizado del quince por ciento.',
    justification:
      'Erosiona el margen objetivo declarado para el ejercicio en curso.',
    estimatedImpact:
      'Recuperar entre dos y cuatro puntos de margen en el canal.',
    advantages:
      'Alinea la práctica comercial con la política escrita y es reversible.',
    drawbacks:
      'Puede tensar la relación con distribuidores acostumbrados al descuento.',
    affectedAreas: 'Área comercial y control de márgenes.',
    migrationPlan:
      'Comunicar el límite y revisar las ofertas abiertas antes del cierre.',
  };

  it('una propuesta completa se publica', () => {
    expect(isPublishableProposal(completa)).toBe(true);
  });

  describe('CRÍTICO: una propuesta a medias NO llega a la pantalla', () => {
    it.each(Object.keys(completa) as (keyof ProposalDraft)[])(
      'sin %s no se publica',
      (campo) => {
        // Un proveedor que responde a medias es el caso NORMAL: se queda sin contexto, corta
        // la respuesta o devuelve una plantilla vacía.
        const resto = { ...completa };
        delete resto[campo];
        expect(isPublishableProposal(resto)).toBe(false);
      },
    );

    it.each([
      ['una palabra suelta', 'sí'],
      ['un "no aplica" vacío', 'n/a'],
      ['solo espacios', '            '],
      ['cadena vacía', ''],
    ])('%s tampoco cuenta como apartado', (_caso, valor) => {
      expect(isPublishableProposal({ ...completa, drawbacks: valor })).toBe(
        false,
      );
    });

    it('nada, nulo o indefinido se rechaza sin romperse', () => {
      expect(isPublishableProposal(null)).toBe(false);
      expect(isPublishableProposal(undefined)).toBe(false);
      expect(isPublishableProposal({})).toBe(false);
    });
  });
});

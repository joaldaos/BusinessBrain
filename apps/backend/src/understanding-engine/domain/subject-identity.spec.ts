import {
  deriveSingleReferent,
  isNovelSubject,
  parseSubjectIdentity,
  subjectIdentityOf,
  validateSubjectProposal,
  type SubjectProposal,
} from './subject-identity';

/**
 * Fase 7.2 — vocabulario canónico de identidad de sujeto.
 *
 * Lo que se prueba: que la identidad describa el REFERENTE y no al observador ni la
 * conclusión, y que toda ruta de duda acabe en sujeto nuevo — nunca en una aproximación a uno
 * existente, que es el daño que §3.4 prohíbe.
 */
describe('subjectIdentityOf / parseSubjectIdentity', () => {
  it('acuña y vuelve a leer la identidad de un referente', () => {
    const value = subjectIdentityOf({
      referentType: 'knowledge-item',
      referentId: 'ki_7f3',
      aspect: 'confianza',
    });

    expect(value).toBe('knowledge-item:ki_7f3#confianza');
    expect(parseSubjectIdentity(value)).toEqual({
      referentType: 'knowledge-item',
      referentId: 'ki_7f3',
      aspect: 'confianza',
    });
  });

  it('el ASPECTO discrimina: dos creencias sobre el mismo documento no son el mismo asunto', () => {
    // Sin este eje, "la confianza de este documento cayó" y "este documento contradice la
    // política de márgenes" se supersederían mutuamente sin parar.
    const confianza = subjectIdentityOf({
      referentType: 'knowledge-item',
      referentId: 'ki_7f3',
      aspect: 'confianza',
    });
    const coherencia = subjectIdentityOf({
      referentType: 'knowledge-item',
      referentId: 'ki_7f3',
      aspect: 'coherencia',
    });

    expect(confianza).not.toBe(coherencia);
  });

  it('el mismo referente y aspecto dan la MISMA identidad vengan de donde vengan', () => {
    // Es la propiedad que hace posible la corroboración entre estrategias distintas (§9), y
    // la que era estructuralmente imposible cuando cada una anteponía su propia clave.
    const desdeUnaEstrategia = subjectIdentityOf({
      referentType: 'knowledge-item',
      referentId: 'ki_7f3',
      aspect: 'confianza',
    });
    const desdeOtra = subjectIdentityOf({
      referentType: 'knowledge-item',
      referentId: 'ki_7f3',
      aspect: 'confianza',
    });

    expect(desdeUnaEstrategia).toBe(desdeOtra);
  });

  describe('no lee lo que no es una identidad canónica', () => {
    it.each([
      // Identidades HISTÓRICAS, anteriores a este vocabulario. No parsean, y no pasa nada:
      // son historia y permanecen intactas. Nada del sistema depende de interpretarlas.
      'confidence-decay:knowledge-item:abc',
      'generative-synthesis:retrasos-entrega-proveedor',
      // Tipo de referente fuera del catálogo.
      'factura:abc#confianza',
      // Aspecto fuera del catálogo.
      'knowledge-item:abc#lo-que-sea',
      // Sin referente.
      'knowledge-item:#confianza',
      'texto suelto',
      '',
    ])('%s', (value) => {
      expect(parseSubjectIdentity(value)).toBeNull();
    });
  });

  it('reconoce un sujeto opaco', () => {
    expect(isNovelSubject('sujeto-nuevo:0d1c9f')).toBe(true);
    expect(isNovelSubject('knowledge-item:abc#confianza')).toBe(false);
  });
});

describe('validateSubjectProposal', () => {
  it('acepta una propuesta bien formada', () => {
    expect(
      validateSubjectProposal({
        referentType: 'knowledge-source',
        referentId: 'src_1',
        aspect: 'disponibilidad',
      }),
    ).toEqual({
      valid: true,
      referentType: 'knowledge-source',
      referentId: 'src_1',
      aspect: 'disponibilidad',
    });
  });

  it('la ABSTENCIÓN es una respuesta legítima, no un fallo', () => {
    expect(validateSubjectProposal({ novel: true })).toEqual({
      valid: false,
      reason: 'ABSTAINED',
    });
  });

  describe('toda propuesta inválida acaba en sujeto nuevo, jamás aproximada', () => {
    it.each([
      ['sin propuesta', null],
      ['indefinida', undefined],
      [
        'tipo de referente fuera del catálogo',
        { referentType: 'factura', referentId: 'x', aspect: 'confianza' },
      ],
      [
        'aspecto fuera del catálogo',
        {
          referentType: 'knowledge-item',
          referentId: 'x',
          aspect: 'lo-que-sea',
        },
      ],
      [
        'referente vacío',
        {
          referentType: 'knowledge-item',
          referentId: '   ',
          aspect: 'confianza',
        },
      ],
    ])('%s', (_caso, proposal) => {
      expect(
        validateSubjectProposal(proposal as unknown as SubjectProposal),
      ).toEqual({ valid: false, reason: 'INVALID_PROPOSAL' });
    });
  });
});

describe('deriveSingleReferent', () => {
  it('con un único referente lo deriva', () => {
    expect(deriveSingleReferent(['ki_1', 'ki_1', 'ki_1'])).toEqual({
      referentId: 'ki_1',
    });
  });

  it('con VARIOS referentes se abstiene: no puede derivar uno con certeza', () => {
    // Elegir uno cualquiera sería fusionar por aproximación. Separar por error solo produce
    // duplicados; fusionar mal produce una supersesión falsa (§3.4).
    expect(deriveSingleReferent(['ki_1', 'ki_2'])).toBeNull();
  });

  it('sin referentes se abstiene', () => {
    expect(deriveSingleReferent([])).toBeNull();
    expect(deriveSingleReferent(['', ''])).toBeNull();
  });
});

import { KnowledgeSourceType } from '@businessbrain/database';
import {
  DEFAULT_CONFIDENCE_WEIGHTS,
  DEFAULT_SOURCE_TRUST,
  computeInitialConfidence,
} from './confidence';

/**
 * Criterio de aceptación de la subfase 2.3 (KNOWLEDGE_ENGINE_DESIGN.md §19):
 * "todo KnowledgeItem indexado tiene [...] un score inicial EXPLICABLE (factores visibles)".
 */
describe('computeInitialConfidence (§8.1)', () => {
  const baseInput = {
    sourceType: KnowledgeSourceType.FILE_UPLOAD,
    classificationCertainty: 0.9,
    contentText: 'a'.repeat(600),
    title: 'Documento interno',
  };

  it('produce un score normalizado en [0,1]', () => {
    const { score } = computeInitialConfidence(baseInput);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('expone TODOS los factores que lo componen, con su peso y su porqué', () => {
    const { factors } = computeInitialConfidence(baseInput);

    expect(factors.map((f) => f.name).sort()).toEqual(
      Object.keys(DEFAULT_CONFIDENCE_WEIGHTS).sort(),
    );
    for (const factor of factors) {
      expect(factor.rationale.length).toBeGreaterThan(0);
      expect(factor.value).toBeGreaterThanOrEqual(0);
      expect(factor.value).toBeLessThanOrEqual(1);
    }
  });

  it('el score es exactamente la suma ponderada de sus factores — es reconstruible', () => {
    const { score, factors } = computeInitialConfidence(baseInput);
    const recomputed = factors.reduce((acc, f) => acc + f.value * f.weight, 0);

    expect(score).toBeCloseTo(recomputed, 4);
  });

  it('es determinista: mismo input, mismo output', () => {
    expect(computeInitialConfidence(baseInput)).toEqual(
      computeInitialConfidence(baseInput),
    );
  });

  it('pondera la confianza base del conector: una web pesa menos que una carga manual', () => {
    const manual = computeInitialConfidence(baseInput);
    const web = computeInitialConfidence({
      ...baseInput,
      sourceType: KnowledgeSourceType.WEBSITE,
    });

    expect(DEFAULT_SOURCE_TRUST.WEBSITE).toBeLessThan(
      DEFAULT_SOURCE_TRUST.FILE_UPLOAD,
    );
    expect(web.score).toBeLessThan(manual.score);
  });

  it('penaliza una clasificación ambigua frente a una certera (§8.1)', () => {
    const certain = computeInitialConfidence(baseInput);
    const ambiguous = computeInitialConfidence({
      ...baseInput,
      classificationCertainty: 0.1,
    });

    expect(ambiguous.score).toBeLessThan(certain.score);
  });

  it('trata la ausencia de clasificación como valor neutro, no como desconfianza', () => {
    const missing = computeInitialConfidence({
      ...baseInput,
      classificationCertainty: null,
    });
    const worst = computeInitialConfidence({
      ...baseInput,
      classificationCertainty: 0,
    });

    expect(missing.score).toBeGreaterThan(worst.score);
    expect(
      missing.factors.find((f) => f.name === 'classificationCertainty')
        ?.rationale,
    ).toMatch(/neutro/i);
  });

  it('penaliza contenido truncado o mal extraído (§8.1, "completitud")', () => {
    const complete = computeInitialConfidence(baseInput);
    const truncated = computeInitialConfidence({
      ...baseInput,
      contentText: 'abc',
    });

    expect(truncated.score).toBeLessThan(complete.score);
  });

  it('penaliza texto con proporción anómala de caracteres sin significado (OCR defectuoso)', () => {
    const clean = computeInitialConfidence(baseInput);
    const garbled = computeInitialConfidence({
      ...baseInput,
      contentText: '#@$%^&*()_+'.repeat(60),
    });

    expect(garbled.score).toBeLessThan(clean.score);
  });

  it('un contenido vacío no rompe el cálculo y puntúa completitud cero', () => {
    const { score, factors } = computeInitialConfidence({
      ...baseInput,
      contentText: '   ',
    });

    expect(Number.isFinite(score)).toBe(true);
    expect(factors.find((f) => f.name === 'contentCompleteness')?.value).toBe(
      0,
    );
  });

  describe('señal de autoridad explícita (§8.1)', () => {
    it('premia un documento firmado frente a uno sin marcador', () => {
      const signed = computeInitialConfidence({
        ...baseInput,
        title: 'Política de vacaciones (firmado)',
      });
      const neutral = computeInitialConfidence(baseInput);

      expect(signed.score).toBeGreaterThan(neutral.score);
    });

    it('penaliza un borrador frente a uno sin marcador', () => {
      const draft = computeInitialConfidence({
        ...baseInput,
        title: 'Política de vacaciones (borrador)',
      });
      const neutral = computeInitialConfidence(baseInput);

      expect(draft.score).toBeLessThan(neutral.score);
    });

    it('ante marcadores contradictorios gana el más informativo sobre su autoridad real', () => {
      // "borrador firmado" es un borrador: la señal que más informa es la que más se
      // aparta del neutro.
      const result = computeInitialConfidence({
        ...baseInput,
        title: 'Contrato borrador firmado',
      });

      expect(
        result.factors.find((f) => f.name === 'authoritySignal')?.value,
      ).toBeLessThan(0.6);
    });

    it('no confunde una subcadena con un marcador real', () => {
      const result = computeInitialConfidence({
        ...baseInput,
        title: 'Informe sobre aprobados del trimestre',
      });

      // "aprobados" no es "aprobado": el marcador exige palabra completa.
      expect(
        result.factors.find((f) => f.name === 'authoritySignal')?.rationale,
      ).toMatch(/Sin marcador/);
    });
  });

  it('un ítem sin conector se puntúa como carga manual, no como desconocido (§3.5)', () => {
    const withoutSource = computeInitialConfidence({
      ...baseInput,
      sourceType: null,
    });
    const manual = computeInitialConfidence(baseInput);

    expect(withoutSource.score).toBe(manual.score);
  });
});

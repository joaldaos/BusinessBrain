import { InsightType } from '@businessbrain/database';
import { KnowledgeSignalStrategy } from './knowledge-signal.strategy';
import type { KnowledgeSignal } from '../../domain/ports/knowledge-signals.port';

/**
 * Subfase 3.1 — UNDERSTANDING_ENGINE_DESIGN.md §6, §7, §8.
 *
 * La estrategia interpreta hechos objetivos del Knowledge Engine y decide qué significan.
 * Esa interpretación es epistemología y vive aquí, nunca en el dominio que emite el hecho.
 */
describe('KnowledgeSignalStrategy (§6, simbólica)', () => {
  const strategy = new KnowledgeSignalStrategy();
  const observedAt = new Date('2026-07-01T10:00:00Z');

  const signal = (
    overrides: Partial<KnowledgeSignal> = {},
  ): KnowledgeSignal => ({
    kind: 'CONFIDENCE_DECAYED',
    subjectKind: 'KNOWLEDGE_ITEM',
    subjectId: 'item-1',
    observedAt,
    facts: {
      title: 'Política de vacaciones',
      confidenceScore: 0.15,
      floor: 0.2,
    },
    ...overrides,
  });

  const run = (signals: KnowledgeSignal[]) =>
    strategy.generate({ organizationId: 'org-1', signals });

  it('declara su identidad, categoría y fiabilidad base (§3.2)', () => {
    expect(strategy.kind).toBe('SYMBOLIC');
    expect(strategy.key.length).toBeGreaterThan(0);
    expect(strategy.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(strategy.baseReliability).toBeGreaterThan(0);
    expect(strategy.baseReliability).toBeLessThanOrEqual(1);
  });

  it('SOLO produce ANOMALY: un juicio de valor exigiría BusinessObjective (§8)', async () => {
    const candidates = await run([
      signal(),
      signal({
        kind: 'SOURCE_DISCONNECTED',
        subjectKind: 'KNOWLEDGE_SOURCE',
        subjectId: 's-1',
      }),
      signal({
        kind: 'CANONICALIZATION_UNRESOLVED',
        subjectKind: 'CANONICAL_ENTITY',
        subjectId: 'c-1',
      }),
    ]);

    expect(candidates).toHaveLength(3);
    expect(candidates.every((c) => c.type === InsightType.ANOMALY)).toBe(true);
    expect(strategy.producibleTypes).toEqual([InsightType.ANOMALY]);
  });

  it('ningún candidato declara tipo de degradación: no lo necesita al no ser RISK/OPPORTUNITY', async () => {
    const [candidate] = await run([signal()]);
    expect(candidate.degradesTo).toBeUndefined();
  });

  describe('identidad de sujeto: PROPUESTA, no acuñada (§3.4, §13)', () => {
    it('propone REFERENTE y ASPECTO, nunca una cadena ya compuesta', async () => {
      const [candidate] = await run([signal()]);

      // Antes esta estrategia componía `confidence-decay:knowledge-item:item-1`,
      // anteponiendo el nombre de su propia regla: ninguna otra estrategia podía llegar
      // jamás al mismo asunto. Ahora describe de QUÉ habla y el dominio resuelve.
      expect(candidate.subjectProposal).toEqual({
        referentType: 'knowledge-item',
        referentId: 'item-1',
        aspect: 'confianza',
      });
    });

    it('es ESTABLE entre observaciones distintas del mismo asunto', async () => {
      // Es lo que permite que dos AnalysisRun sucesivos no dupliquen el Insight.
      const [primera] = await run([signal()]);
      const [segunda] = await run([
        signal({
          observedAt: new Date('2026-08-15T04:00:00Z'),
          facts: {
            title: 'Política de vacaciones',
            confidenceScore: 0.11,
            floor: 0.2,
          },
        }),
      ]);

      expect(segunda.subjectProposal).toEqual(primera.subjectProposal);
    });

    it('distingue asuntos distintos aunque sean del mismo tipo', async () => {
      const [a] = await run([signal({ subjectId: 'item-1' })]);
      const [b] = await run([signal({ subjectId: 'item-2' })]);

      expect(a.subjectProposal).not.toEqual(b.subjectProposal);
    });

    it('el mismo referente observado en OTRA dimensión es otro asunto', async () => {
      const [decay] = await run([signal({ subjectId: 'x' })]);
      const [disconnected] = await run([
        signal({
          kind: 'SOURCE_DISCONNECTED',
          subjectKind: 'KNOWLEDGE_SOURCE',
          subjectId: 'x',
        }),
      ]);

      // Mismo identificador, referente y aspecto distintos: el aspecto es lo que impide
      // que todo lo que se afirme sobre algo colapse en un solo sujeto.
      expect(decay.subjectProposal).not.toEqual(disconnected.subjectProposal);
    });

    it('ninguna propuesta contiene el nombre de la estrategia ni el tipo del hallazgo', async () => {
      const [candidate] = await run([signal()]);

      const serializada = JSON.stringify(candidate.subjectProposal);
      expect(serializada).not.toContain('confidence-decay');
      expect(serializada).not.toContain('ANOMALY');
    });
  });

  describe('trazabilidad (§10)', () => {
    it('cada candidato es trazable hasta la señal exacta que lo originó', async () => {
      const [candidate] = await run([signal()]);

      expect(candidate.evidence).toHaveLength(1);
      expect(candidate.evidence[0].refId).toBe('item-1');
      expect(candidate.evidence[0].role).toBe('DEVIATION');
    });

    it('la traza incluye la regla determinista que se disparó, no texto libre', async () => {
      const [candidate] = await run([signal()]);

      expect(candidate.reasoningTrace.strategyKind).toBe('SYMBOLIC');
      expect(candidate.reasoningTrace.rule).toBe(
        'confidenceScore <= minimumFloor',
      );
      expect(candidate.reasoningTrace.signalKind).toBe('CONFIDENCE_DECAYED');
      expect(candidate.reasoningTrace.facts).toEqual(signal().facts);
    });

    it('el resumen explica el hallazgo en términos verificables', async () => {
      const [candidate] = await run([signal()]);

      expect(candidate.summary).toContain('Política de vacaciones');
      expect(candidate.summary).toContain('0.15');
      expect(candidate.summary).toContain('0.20');
    });
  });

  it('la confianza cruda es máxima: la señal es un hecho, no una estimación (§9)', async () => {
    const [candidate] = await run([signal()]);
    expect(candidate.rawConfidence).toBe(1);
  });

  it('ignora en silencio una señal que no sabe interpretar, sin inventar conclusiones', async () => {
    const candidates = await run([
      signal({ kind: 'UNKNOWN_FUTURE_SIGNAL' as KnowledgeSignal['kind'] }),
    ]);

    expect(candidates).toEqual([]);
  });

  it('sin señales no produce candidatos', async () => {
    expect(await run([])).toEqual([]);
  });

  it('es determinista: las mismas señales producen los mismos candidatos', async () => {
    const signals = [signal(), signal({ subjectId: 'item-2' })];
    expect(await run(signals)).toEqual(await run(signals));
  });
});

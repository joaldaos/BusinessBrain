import {
  BrokenBeliefChainError,
  attributeTransition,
  buildBeliefTrajectory,
  orderBeliefChain,
  type BeliefVersionInput,
} from './belief-trajectory';

/**
 * Fase 7 — trayectoria de una creencia.
 *
 * Lo que se prueba aquí es que la historia sea FIEL: que el orden no dependa del reloj, que
 * una cadena imposible se detecte en vez de producir una historia silenciosamente incorrecta,
 * y que la atribución no filtre lo que el alcance protege.
 */
const version = (
  id: string,
  overrides: Partial<BeliefVersionInput> = {},
): BeliefVersionInput => ({
  id,
  supersedesInsightId: null,
  confidence: 0.8,
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  analysisRunId: 'run-1',
  transitiveEvidenceClosure: [],
  contradictingRefIds: [],
  ...overrides,
});

describe('orderBeliefChain', () => {
  it('ordena por la CADENA, no por el reloj', () => {
    // Las tres nacen en el mismo instante: ordenar por tiempo daría un orden arbitrario.
    const mismoInstante = new Date('2026-01-01T00:00:00.000Z');
    const v1 = version('v1', { createdAt: mismoInstante });
    const v2 = version('v2', {
      supersedesInsightId: 'v1',
      createdAt: mismoInstante,
    });
    const v3 = version('v3', {
      supersedesInsightId: 'v2',
      createdAt: mismoInstante,
    });

    // Se pasan desordenadas a propósito.
    expect(orderBeliefChain([v3, v1, v2]).map((v) => v.id)).toEqual([
      'v1',
      'v2',
      'v3',
    ]);
  });

  it('un reloj desfasado no altera el orden', () => {
    const v1 = version('v1', { createdAt: new Date('2026-06-01') });
    // La sucesora dice haber nacido ANTES: desfase entre procesos.
    const v2 = version('v2', {
      supersedesInsightId: 'v1',
      createdAt: new Date('2026-01-01'),
    });

    expect(orderBeliefChain([v1, v2]).map((v) => v.id)).toEqual(['v1', 'v2']);
  });

  it('una sola versión es una trayectoria válida', () => {
    expect(orderBeliefChain([version('v1')]).map((v) => v.id)).toEqual(['v1']);
  });

  it('sin versiones devuelve vacío', () => {
    expect(orderBeliefChain([])).toEqual([]);
  });

  it('RECHAZA una bifurcación en vez de inventar una historia', () => {
    const v1 = version('v1');
    const a = version('a', { supersedesInsightId: 'v1' });
    const b = version('b', { supersedesInsightId: 'v1' });

    expect(() => orderBeliefChain([v1, a, b])).toThrow(BrokenBeliefChainError);
    expect(() => orderBeliefChain([v1, a, b])).toThrow(/bifurcada/i);
  });

  it('RECHAZA un ciclo en vez de colgarse', () => {
    const a = version('a', { supersedesInsightId: 'b' });
    const b = version('b', { supersedesInsightId: 'a' });

    expect(() => orderBeliefChain([a, b])).toThrow(/[Cc]iclo/);
  });

  it('tolera una página que no incluye a su predecesora', () => {
    // Al paginar la historia, la primera de la página apunta a una versión que no vino.
    const v2 = version('v2', { supersedesInsightId: 'v1-fuera-de-pagina' });
    const v3 = version('v3', { supersedesInsightId: 'v2' });

    expect(orderBeliefChain([v3, v2]).map((v) => v.id)).toEqual(['v2', 'v3']);
  });
});

describe('attributeTransition', () => {
  const ref = (refId: string) => ({ kind: 'KNOWLEDGE_ITEM', refId });

  it('identifica la evidencia que ENTRÓ y provocó el cambio', () => {
    const transition = attributeTransition({
      previous: version('v1', {
        confidence: 0.6,
        transitiveEvidenceClosure: [ref('doc-a')],
      }),
      next: version('v2', {
        confidence: 0.8,
        transitiveEvidenceClosure: [ref('doc-a'), ref('doc-b')],
      }),
      visibleRefIds: null,
    });

    expect(transition.changes).toEqual([
      { kind: 'ENTERED', ref: ref('doc-b') },
    ]);
    expect(transition.confidenceDelta).toBe(0.2);
  });

  it('identifica la evidencia que SALIÓ', () => {
    const transition = attributeTransition({
      previous: version('v1', {
        transitiveEvidenceClosure: [ref('doc-a'), ref('doc-b')],
      }),
      next: version('v2', { transitiveEvidenceClosure: [ref('doc-a')] }),
      visibleRefIds: null,
    });

    expect(transition.changes).toEqual([{ kind: 'LEFT', ref: ref('doc-b') }]);
  });

  it('identifica una CONTRADICCIÓN aunque la evidencia siguiera presente', () => {
    const transition = attributeTransition({
      previous: version('v1', {
        confidence: 0.9,
        transitiveEvidenceClosure: [ref('doc-a')],
      }),
      next: version('v2', {
        confidence: 0.8,
        transitiveEvidenceClosure: [ref('doc-a')],
        contradictingRefIds: ['doc-a'],
      }),
      visibleRefIds: null,
    });

    expect(transition.changes).toEqual([
      { kind: 'CONTRADICTED', ref: ref('doc-a') },
    ]);
    expect(transition.confidenceDelta).toBeCloseTo(-0.1, 4);
  });

  it('identifica evidencia REEMPLAZADA en origen', () => {
    const transition = attributeTransition({
      previous: version('v1', { transitiveEvidenceClosure: [ref('doc-a')] }),
      next: version('v2', { transitiveEvidenceClosure: [ref('doc-a')] }),
      visibleRefIds: null,
      supersededEvidenceRefIds: new Set(['doc-a']),
    });

    expect(transition.changes).toEqual([
      { kind: 'SUPERSEDED_EVIDENCE', ref: ref('doc-a') },
    ]);
  });

  it('sin cambios de evidencia, la transición no inventa ninguno', () => {
    const transition = attributeTransition({
      previous: version('v1', {
        confidence: 0.6,
        transitiveEvidenceClosure: [ref('doc-a')],
      }),
      next: version('v2', {
        confidence: 0.7,
        transitiveEvidenceClosure: [ref('doc-a')],
      }),
      visibleRefIds: null,
    });

    expect(transition.changes).toEqual([]);
    expect(transition.changesOutOfScope).toBe(0);
  });

  describe('no filtra nada fuera del alcance del lector', () => {
    it('omite los identificadores que no puede ver y los CUENTA', () => {
      const transition = attributeTransition({
        previous: version('v1', {
          confidence: 0.6,
          transitiveEvidenceClosure: [ref('ventas-1')],
        }),
        next: version('v2', {
          confidence: 0.9,
          transitiveEvidenceClosure: [
            ref('ventas-1'),
            ref('ventas-2'),
            ref('rrhh-secreto'),
          ],
        }),
        visibleRefIds: new Set(['ventas-1', 'ventas-2']),
      });

      expect(transition.changes).toEqual([
        { kind: 'ENTERED', ref: ref('ventas-2') },
      ]);
      // Se sabe que hubo otro cambio, nunca cuál. Sin el recuento la historia mentiría por
      // omisión: parecería que la confianza subió sin motivo.
      expect(transition.changesOutOfScope).toBe(1);
      expect(JSON.stringify(transition)).not.toContain('rrhh-secreto');
    });

    it('con todo fuera de alcance no revela ni un identificador', () => {
      const transition = attributeTransition({
        previous: version('v1', { transitiveEvidenceClosure: [] }),
        next: version('v2', {
          transitiveEvidenceClosure: [ref('rrhh-a'), ref('rrhh-b')],
        }),
        visibleRefIds: new Set(),
      });

      expect(transition.changes).toEqual([]);
      expect(transition.changesOutOfScope).toBe(2);
      expect(JSON.stringify(transition)).not.toContain('rrhh');
    });
  });
});

describe('buildBeliefTrajectory', () => {
  const ref = (refId: string) => ({ kind: 'KNOWLEDGE_ITEM', refId });

  it('devuelve versiones ordenadas y una transición menos que versiones', () => {
    const trajectory = buildBeliefTrajectory({
      versions: [
        version('v3', { supersedesInsightId: 'v2', confidence: 0.9 }),
        version('v1', { confidence: 0.5 }),
        version('v2', { supersedesInsightId: 'v1', confidence: 0.7 }),
      ],
      visibleRefIds: null,
    });

    expect(trajectory.versions.map((v) => v.id)).toEqual(['v1', 'v2', 'v3']);
    expect(trajectory.transitions).toHaveLength(2);
    expect(trajectory.transitions.map((t) => t.newConfidence)).toEqual([
      0.7, 0.9,
    ]);
  });

  it('una creencia que nunca cambió no tiene transiciones', () => {
    const trajectory = buildBeliefTrajectory({
      versions: [version('v1')],
      visibleRefIds: null,
    });

    expect(trajectory.versions).toHaveLength(1);
    expect(trajectory.transitions).toEqual([]);
  });

  it('una versión oculta no parte la historia: desaparece y se cuenta', () => {
    const trajectory = buildBeliefTrajectory({
      versions: [
        version('v1', {
          confidence: 0.5,
          transitiveEvidenceClosure: [ref('doc-a')],
        }),
        version('v2', {
          supersedesInsightId: 'v1',
          confidence: 0.6,
          transitiveEvidenceClosure: [ref('doc-a'), ref('doc-oculto')],
        }),
        version('v3', {
          supersedesInsightId: 'v2',
          confidence: 0.9,
          transitiveEvidenceClosure: [ref('doc-a'), ref('doc-c')],
        }),
      ],
      visibleRefIds: new Set(['doc-a', 'doc-c']),
      visibleVersionIds: new Set(['v1', 'v3']),
    });

    expect(trajectory.versions.map((v) => v.id)).toEqual(['v1', 'v3']);
    // Una sola transición, entre las dos visibles consecutivas.
    expect(trajectory.transitions).toHaveLength(1);
    expect(trajectory.hiddenVersionCount).toBe(1);
    // Y ni rastro de lo que no puede ver.
    expect(JSON.stringify(trajectory)).not.toContain('doc-oculto');
  });

  it('la trayectoria completa nombra la evidencia exacta de cada cambio', () => {
    const trajectory = buildBeliefTrajectory({
      versions: [
        version('v1', {
          confidence: 0.5,
          transitiveEvidenceClosure: [ref('doc-a')],
        }),
        version('v2', {
          supersedesInsightId: 'v1',
          confidence: 0.8,
          transitiveEvidenceClosure: [ref('doc-a'), ref('doc-b')],
        }),
      ],
      visibleRefIds: null,
    });

    expect(trajectory.transitions[0].changes).toEqual([
      { kind: 'ENTERED', ref: ref('doc-b') },
    ]);
  });
});

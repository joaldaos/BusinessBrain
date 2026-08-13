import {
  ABANDONED_RUN_THRESHOLD_MS,
  admitAnalysisRun,
  blockedRunExplanation,
} from './analysis-run-concurrency';

/**
 * Subfase 6.1 — admisión de ejecuciones de análisis.
 *
 * Las dos mitades importan por igual: sin el rechazo, un reintento del proxy duplica la
 * factura del cliente; sin la recuperación, un proceso muerto bloquea la organización para
 * siempre y el control de concurrencia se vuelve una denegación de servicio contra uno mismo.
 */
describe('admitAnalysisRun', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');
  const agoMs = (ms: number) => new Date(now.getTime() - ms);

  const inFlight = (overrides: Partial<{ startedAt: Date | null }> = {}) => ({
    id: 'run-en-curso',
    startedAt: agoMs(60_000),
    createdAt: agoMs(60_000),
    ...overrides,
  });

  it('arranca si no hay ninguna ejecución en curso', () => {
    expect(admitAnalysisRun({ inFlight: null, now })).toEqual({
      decision: 'START',
    });
  });

  it('RECHAZA si hay una ejecución viva', () => {
    const admission = admitAnalysisRun({ inFlight: inFlight(), now });

    expect(admission.decision).toBe('REJECT');
    expect(admission.decision === 'REJECT' && admission.blockingRunId).toBe(
      'run-en-curso',
    );
  });

  it('RECLAMA una ejecución abandonada en vez de bloquear para siempre', () => {
    const admission = admitAnalysisRun({
      inFlight: inFlight({ startedAt: agoMs(ABANDONED_RUN_THRESHOLD_MS + 1) }),
      now,
    });

    expect(admission.decision).toBe('RECLAIM');
    expect(admission.decision === 'RECLAIM' && admission.abandonedRunId).toBe(
      'run-en-curso',
    );
  });

  it('en el instante EXACTO del umbral todavía respeta la ejecución en curso', () => {
    // Ante la duda se protege a la que ya corre: el error caro es duplicar, no esperar.
    const admission = admitAnalysisRun({
      inFlight: inFlight({ startedAt: agoMs(ABANDONED_RUN_THRESHOLD_MS) }),
      now,
    });

    expect(admission.decision).toBe('REJECT');
  });

  it('sin `startedAt` mide desde la creación: lo que cuenta es ocupar el hueco', () => {
    const reciente = admitAnalysisRun({
      inFlight: {
        id: 'run-sin-arrancar',
        startedAt: null,
        createdAt: agoMs(1_000),
      },
      now,
    });
    const antigua = admitAnalysisRun({
      inFlight: {
        id: 'run-sin-arrancar',
        startedAt: null,
        createdAt: agoMs(ABANDONED_RUN_THRESHOLD_MS + 1),
      },
      now,
    });

    expect(reciente.decision).toBe('REJECT');
    expect(antigua.decision).toBe('RECLAIM');
  });

  it('el umbral es configurable para poder probarlo sin esperar quince minutos', () => {
    const admission = admitAnalysisRun({
      inFlight: inFlight({ startedAt: agoMs(50) }),
      now,
      thresholdMs: 10,
    });

    expect(admission.decision).toBe('RECLAIM');
  });

  it('una ejecución del futuro no se declara abandonada', () => {
    // Desfase de reloj entre procesos: el tiempo transcurrido sale negativo y jamás debe
    // interpretarse como "lleva mucho tiempo".
    const admission = admitAnalysisRun({
      inFlight: inFlight({ startedAt: new Date(now.getTime() + 60_000) }),
      now,
    });

    expect(admission.decision).toBe('REJECT');
  });
});

describe('blockedRunExplanation', () => {
  it('dice cuál bloquea y desde cuándo', () => {
    const message = blockedRunExplanation(
      'run-1',
      new Date('2026-08-08T11:59:00.000Z'),
    );

    expect(message).toContain('run-1');
    expect(message).toContain('2026-08-08T11:59:00.000Z');
  });

  it('explica también el caso de una ejecución que no llegó a arrancar', () => {
    expect(blockedRunExplanation('run-1', null)).toMatch(/sin arrancar/i);
  });
});

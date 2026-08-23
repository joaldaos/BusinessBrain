import { OperationalAlertsService } from './operational-alerts.service';
import type { AlertsPort } from '../domain/alerts.port';
import type { OperationalAlert } from '../domain/operational-alert';
import type { PrismaService } from '../../prisma/prisma.service';

describe('cuándo se avisa de un fallo operativo', () => {
  let emitidas: OperationalAlert[];
  let canal: AlertsPort;
  let historial: { status: string }[];
  let service: OperationalAlertsService;

  beforeEach(() => {
    emitidas = [];
    canal = {
      raise: (alert) => {
        emitidas.push(alert);
        return Promise.resolve();
      },
    };
    historial = [];

    const prisma = {
      ingestionJob: {
        findMany: () => Promise.resolve(historial),
      },
    } as unknown as PrismaService;

    service = new OperationalAlertsService(prisma, canal);
  });

  const sincronizacionFallida = () =>
    service.syncFailed({
      organizationId: 'org-1',
      knowledgeSourceId: 'fuente-1',
      detail: 'no se pudo leer',
    });

  it('un fallo suelto avisa una vez', async () => {
    historial = [{ status: 'FAILED' }, { status: 'SUCCESS' }];

    await sincronizacionFallida();

    expect(emitidas.map((a) => a.kind)).toEqual(['sync-failed']);
  });

  it('CRÍTICO: tres fallos seguidos avisan además de que la fuente está rota', async () => {
    // "Una noche mala" y "esto no se arregla solo" son cosas distintas y merecen avisos
    // distintos: el segundo es el que hace que alguien vaya a mirar de verdad.
    historial = [
      { status: 'FAILED' },
      { status: 'FAILED' },
      { status: 'FAILED' },
    ];

    await sincronizacionFallida();

    expect(emitidas.map((a) => a.kind)).toEqual([
      'sync-failed',
      'source-failing-repeatedly',
    ]);
    expect(emitidas[1].consecutiveFailures).toBe(3);
  });

  it('una ejecución correcta corta la racha', async () => {
    // "Tres de las últimas diez" es una fuente con altibajos; "las tres últimas" es una
    // fuente rota. Solo la segunda merece el aviso.
    historial = [
      { status: 'FAILED' },
      { status: 'SUCCESS' },
      { status: 'FAILED' },
    ];

    await sincronizacionFallida();

    expect(emitidas.map((a) => a.kind)).toEqual(['sync-failed']);
  });

  it('un análisis fallido avisa', async () => {
    await service.analysisFailed({
      organizationId: 'org-1',
      analysisRunId: 'run-1',
      detail: 'el proveedor no respondió',
    });

    expect(emitidas).toHaveLength(1);
    expect(emitidas[0].kind).toBe('analysis-failed');
    expect(emitidas[0].targetId).toBe('run-1');
  });

  it('CRÍTICO: si el canal falla, no se propaga', async () => {
    // Lo que se está avisando ES un fallo. Que el aviso lo empeore sería absurdo: la
    // sincronización ya terminó y su resultado ya está guardado.
    const roto = new OperationalAlertsService(
      {
        ingestionJob: { findMany: () => Promise.resolve([]) },
      } as unknown as PrismaService,
      { raise: () => Promise.reject(new Error('el canal no responde')) },
    );

    await expect(
      roto.syncFailed({
        organizationId: 'org-1',
        knowledgeSourceId: 'fuente-1',
        detail: 'da igual',
      }),
    ).resolves.toBeUndefined();
  });
});

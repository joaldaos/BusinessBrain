import { randomBytes } from 'node:crypto';
import {
  BusinessEventKind,
  ConnectionStatus,
  RunStatus,
} from '@businessbrain/database';
import { BusinessConnectorRegistry } from '../../src/connectors/application/business-connector-registry.service';
import { RunConnectorSyncUseCase } from '../../src/connectors/application/run-connector-sync.use-case';
import { RecordBusinessFactsUseCase } from '../../src/business-facts/application/record-business-facts.use-case';
import { ConnectorUsageService } from '../../src/connectors/application/connector-usage.service';
import { EncryptionService } from '../../src/common/utils/encryption.util';
import type { BusinessConnectorPort } from '../../src/connectors/domain/ports/business-connector.port';
import type { NormalizedBatch } from '../../src/business-facts/domain/normalized-batch';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  createTestOrg,
  destroyTestOrg,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * Una sincronización de punta a punta — Fase 9A.
 *
 * Es la prueba que demuestra que la arquitectura funciona: conector → lote normalizado →
 * hechos escritos → marcador avanzado, todo en una transacción.
 *
 * Y, sobre todo, demuestra qué pasa cuando algo falla a mitad. Ese es el caso que decide si
 * una integración es fiable: si el marcador avanzara sin que los hechos se hubieran escrito,
 * esos hechos **se perderían para siempre**, porque la siguiente pasada empieza más adelante
 * y nadie vuelve a por ellos.
 */
describe('Sincronización de un conector (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let caso: RunConnectorSyncUseCase;
  let loteDevuelto: NormalizedBatch;
  let fallo: Error | null;

  const CLAVE = 'tpv_ficticio_v1';

  /** Un conector de prueba. Devuelve lo que el test le ponga, o falla si se le pide. */
  const conectorFalso = (): BusinessConnectorPort => ({
    key: CLAVE,
    displayName: 'TPV de prueba',
    identity: { authKind: 'API_KEY', scopesDescription: [] },
    capabilities: {
      entities: [],
      events: [BusinessEventKind.SALE_RECORDED],
      delivery: 'POLL',
      backfill: false,
    },
    describeScope: () => null,
    pull: () => {
      if (fallo) return Promise.reject(fallo);
      return Promise.resolve(loteDevuelto);
    },
    health: () => Promise.resolve({ ok: true }),
  });

  const venta = (externalId: string) => ({
    kind: BusinessEventKind.SALE_RECORDED,
    externalId,
    occurredAt: new Date('2026-10-17T21:30:00.000Z'),
    amountCents: 1_500,
    currency: 'EUR',
  });

  const crearConector = () =>
    prisma.organizationConnector.create({
      data: {
        organizationId: org.orgId,
        connectorKey: CLAVE,
        displayName: 'TPV de prueba',
        status: ConnectionStatus.CONNECTED,
        createdById: org.userId,
      },
      select: { id: true },
    });

  beforeEach(async () => {
    org = await createTestOrg('sync-int');
    loteDevuelto = { entities: [], events: [] };
    fallo = null;

    const encryption = new EncryptionService({
      get: () => randomBytes(32).toString('base64'),
    } as never);

    caso = new RunConnectorSyncUseCase(
      db,
      new BusinessConnectorRegistry([conectorFalso()]),
      new RecordBusinessFactsUseCase(db),
      encryption,
      new ConnectorUsageService(db),
    );
  });

  afterEach(async () => {
    await prisma.businessEvent.deleteMany({
      where: { organizationId: org.orgId },
    });
    await prisma.businessEntity.deleteMany({
      where: { organizationId: org.orgId },
    });
    await prisma.usageRecord.deleteMany({
      where: { organizationId: org.orgId },
    });
    await destroyTestOrg(org);
  });

  it('trae los hechos, los escribe y avanza el marcador', async () => {
    const { id } = await crearConector();
    loteDevuelto = {
      entities: [],
      events: [venta('t-1'), venta('t-2')],
      cursor: { desde: '2026-10-17T22:00:00Z' },
    };

    const resultado = await caso.execute({
      organizationId: org.orgId,
      connectorId: id,
    });

    expect(resultado.status).toBe(RunStatus.SUCCESS);
    expect(resultado.stats.eventsCreated).toBe(2);

    const fila = await prisma.organizationConnector.findUniqueOrThrow({
      where: { id },
    });
    expect(fila.syncCursor).toEqual({ desde: '2026-10-17T22:00:00Z' });
    expect(fila.lastSyncedAt).not.toBeNull();
    expect(fila.lastError).toBeNull();
  });

  it('deja registrada la ejecución con sus cifras', async () => {
    const { id } = await crearConector();
    loteDevuelto = { entities: [], events: [venta('t-1')] };

    const { syncId } = await caso.execute({
      organizationId: org.orgId,
      connectorId: id,
    });

    const sync = await prisma.connectorSync.findUniqueOrThrow({
      where: { id: syncId },
    });
    expect(sync.status).toBe(RunStatus.SUCCESS);
    expect(sync.finishedAt).not.toBeNull();
    expect(sync.stats).toMatchObject({ eventsCreated: 1 });
  });

  describe('cuando el proveedor falla', () => {
    it('NO avanza el marcador: esos hechos se recuperan en la siguiente pasada', async () => {
      const { id } = await crearConector();
      loteDevuelto = { entities: [], events: [venta('t-1')], cursor: { p: 1 } };
      await caso.execute({ organizationId: org.orgId, connectorId: id });

      fallo = new Error('el TPV no responde');
      await expect(
        caso.execute({ organizationId: org.orgId, connectorId: id }),
      ).rejects.toThrow('el TPV no responde');

      const fila = await prisma.organizationConnector.findUniqueOrThrow({
        where: { id },
      });
      // Donde lo dejó la pasada BUENA, no más adelante.
      expect(fila.syncCursor).toEqual({ p: 1 });
      expect(fila.status).toBe(ConnectionStatus.ERROR);
      expect(fila.lastError).toBe('el TPV no responde');
    });

    it('registra la ejecución fallida con su motivo', async () => {
      const { id } = await crearConector();
      fallo = new Error('credenciales rechazadas');

      await expect(
        caso.execute({ organizationId: org.orgId, connectorId: id }),
      ).rejects.toThrow();

      const syncs = await prisma.connectorSync.findMany({
        where: { connectorId: id },
      });
      expect(syncs).toHaveLength(1);
      expect(syncs[0]?.status).toBe(RunStatus.FAILED);
      expect(syncs[0]?.error).toBe('credenciales rechazadas');
    });

    it('vuelve a traer lo mismo sin duplicarlo', async () => {
      const { id } = await crearConector();
      loteDevuelto = { entities: [], events: [venta('t-1')] };

      await caso.execute({ organizationId: org.orgId, connectorId: id });
      await caso.execute({ organizationId: org.orgId, connectorId: id });

      expect(
        await prisma.businessEvent.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(1);
    });
  });

  describe('aislamiento', () => {
    it('otra empresa no puede sincronizar este conector', async () => {
      const { id } = await crearConector();
      const otra = await createTestOrg('sync-ajena');

      await expect(
        caso.execute({ organizationId: otra.orgId, connectorId: id }),
      ).rejects.toThrow(/no encontrado/i);

      // Y no ha quedado ninguna ejecución registrada a nombre de nadie.
      expect(
        await prisma.connectorSync.count({ where: { connectorId: id } }),
      ).toBe(0);

      await destroyTestOrg(otra);
    });

    it('los hechos quedan atribuidos al conector que los trajo', async () => {
      const { id } = await crearConector();
      loteDevuelto = { entities: [], events: [venta('t-1')] };

      await caso.execute({ organizationId: org.orgId, connectorId: id });

      const hecho = await prisma.businessEvent.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });
      expect(hecho.connectorId).toBe(id);
    });
  });

  /**
   * El techo diario — Fase 9B.
   *
   * No protege al cliente de su factura (eso es el techo de IA): nos protege a nosotros. El
   * caso real es un TPV mal configurado reenviando el mismo día en bucle, o una recuperación
   * de histórico lanzada sobre cinco años de tickets. La idempotencia impide que se
   * dupliquen; no impide que sean demasiados.
   */
  describe('techo diario de hechos', () => {
    const ponerTecho = (limite: number) =>
      prisma.organization.update({
        where: { id: org.orgId },
        data: { settings: { connectors: { dailyEventLimit: limite } } },
      });

    it('apunta los hechos CREADOS, no los recibidos', async () => {
      const { id } = await crearConector();
      loteDevuelto = { entities: [], events: [venta('t-1'), venta('t-2')] };

      await caso.execute({ organizationId: org.orgId, connectorId: id });
      // Segunda pasada idéntica: la idempotencia los absorbe, así que no consumen techo.
      await caso.execute({ organizationId: org.orgId, connectorId: id });

      const consumo = await prisma.usageRecord.findFirst({
        where: { organizationId: org.orgId, metric: 'connector_events' },
      });
      expect(consumo?.value).toBe(2);
    });

    it('al alcanzarlo, OMITE la sincronización en vez de fallar', async () => {
      const { id } = await crearConector();
      await ponerTecho(1);
      loteDevuelto = { entities: [], events: [venta('t-1'), venta('t-2')] };

      // La primera pasa y se pasa del techo: el lote que lo cruza se escribe entero.
      await caso.execute({ organizationId: org.orgId, connectorId: id });

      loteDevuelto = { entities: [], events: [venta('t-3')] };
      const segunda = await caso.execute({
        organizationId: org.orgId,
        connectorId: id,
      });

      expect(segunda.status).toBe(RunStatus.SKIPPED);
      // Y el hecho nuevo NO entró.
      expect(
        await prisma.businessEvent.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(2);
    });

    /**
     * Omitir no es fallar, y la diferencia importa: si se tratara como fallo, la cola
     * gastaría sus reintentos en algo que solo se arregla esperando a mañana y acabaría
     * enterrando el conector, que dejaría de sincronizar hasta que alguien lo tocara.
     */
    it('omitir NO avanza el marcador: lo de hoy entra mañana', async () => {
      const { id } = await crearConector();
      loteDevuelto = { entities: [], events: [venta('t-1')], cursor: { p: 7 } };
      await caso.execute({ organizationId: org.orgId, connectorId: id });

      await ponerTecho(1);
      loteDevuelto = {
        entities: [],
        events: [venta('t-9')],
        cursor: { p: 99 },
      };
      await caso.execute({ organizationId: org.orgId, connectorId: id });

      const fila = await prisma.organizationConnector.findUniqueOrThrow({
        where: { id },
      });
      expect(fila.syncCursor).toEqual({ p: 7 });
    });

    it('explica el motivo en el idioma de la empresa', async () => {
      const { id } = await crearConector();
      await ponerTecho(1);
      loteDevuelto = { entities: [], events: [venta('t-1'), venta('t-2')] };
      await caso.execute({ organizationId: org.orgId, connectorId: id });
      await caso.execute({ organizationId: org.orgId, connectorId: id });

      const omitida = await prisma.connectorSync.findFirstOrThrow({
        where: { connectorId: id, status: RunStatus.SKIPPED },
      });
      expect(omitida.error).toMatch(/máximo|mañana/i);
      expect(omitida.error).not.toMatch(/UsageRecord|metric|periodStart/i);
    });

    it('el techo es de cada empresa: el de una no frena a la otra', async () => {
      const { id } = await crearConector();
      await ponerTecho(1);
      loteDevuelto = { entities: [], events: [venta('t-1'), venta('t-2')] };
      await caso.execute({ organizationId: org.orgId, connectorId: id });

      const otra = await createTestOrg('sync-techo-vecina');
      const suyo = await prisma.organizationConnector.create({
        data: {
          organizationId: otra.orgId,
          connectorKey: CLAVE,
          displayName: 'TPV vecino',
          status: ConnectionStatus.CONNECTED,
          createdById: otra.userId,
        },
        select: { id: true },
      });

      loteDevuelto = { entities: [], events: [venta('t-vecina')] };
      const suya = await caso.execute({
        organizationId: otra.orgId,
        connectorId: suyo.id,
      });

      expect(suya.status).toBe(RunStatus.SUCCESS);

      await prisma.businessEvent.deleteMany({
        where: { organizationId: otra.orgId },
      });
      await prisma.usageRecord.deleteMany({
        where: { organizationId: otra.orgId },
      });
      await prisma.organizationConnector.deleteMany({
        where: { organizationId: otra.orgId },
      });
      await destroyTestOrg(otra);
    });
  });

  it('un conector cuya implementación ya no existe se dice, no se traga', async () => {
    const huerfano = await prisma.organizationConnector.create({
      data: {
        organizationId: org.orgId,
        connectorKey: 'retirado_v1',
        displayName: 'Retirado',
        createdById: org.userId,
      },
      select: { id: true },
    });

    await expect(
      caso.execute({ organizationId: org.orgId, connectorId: huerfano.id }),
    ).rejects.toThrow(/retirado_v1/);
  });
});

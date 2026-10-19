import { BusinessEntityKind, BusinessEventKind } from '@businessbrain/database';
import { RecordBusinessFactsUseCase } from '../../src/business-facts/application/record-business-facts.use-case';
import type { NormalizedBatch } from '../../src/business-facts/domain/normalized-batch';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  createTestOrg,
  destroyTestOrg,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * El registro de hechos, contra Postgres de verdad — Fase 9A.
 *
 * Lo que se comprueba aquí no lo puede demostrar ningún doble, porque todo depende del
 * motor: que el índice único absorba un reenvío simultáneo, que una clave foránea compuesta
 * impida ligar el hecho de una empresa al cliente de otra, y que escribir hechos quepa en la
 * transacción de quien los pide.
 *
 * Un duplicado aquí no es una fila de más: es **una venta que la empresa no hizo** metida en
 * sus cuentas.
 */
describe('Hechos empresariales (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let registro: RecordBusinessFactsUseCase;

  const CONECTOR = 'tpv_prueba_v1';

  beforeEach(async () => {
    org = await createTestOrg('facts-int');
    registro = new RecordBusinessFactsUseCase(db);
  });

  afterEach(async () => {
    await prisma.businessEvent.deleteMany({
      where: { organizationId: org.orgId },
    });
    await prisma.businessEntity.deleteMany({
      where: { organizationId: org.orgId },
    });
    await destroyTestOrg(org);
  });

  const escribir = (batch: NormalizedBatch) =>
    registro.record({
      organizationId: org.orgId,
      connectorId: CONECTOR,
      batch,
    });

  const venta = (externalId: string, extra = {}) => ({
    kind: BusinessEventKind.SALE_RECORDED,
    externalId,
    occurredAt: new Date('2026-10-17T21:30:00.000Z'),
    amountCents: 2_450,
    currency: 'EUR',
    ...extra,
  });

  describe('idempotencia', () => {
    it('el mismo hecho dos veces produce UNA fila', async () => {
      const lote = { entities: [], events: [venta('ticket-1')] };

      const primera = await escribir(lote);
      const segunda = await escribir(lote);

      expect(primera.stats.eventsCreated).toBe(1);
      expect(segunda.stats.eventsCreated).toBe(0);
      expect(segunda.stats.eventsSkippedDuplicate).toBe(1);

      const filas = await prisma.businessEvent.findMany({
        where: { organizationId: org.orgId },
      });
      expect(filas).toHaveLength(1);
    });

    /** Dos entregas simultáneas del mismo webhook: la carrera que la aplicación no puede ganar. */
    it('aguanta seis escrituras SIMULTÁNEAS del mismo hecho', async () => {
      const lote = { entities: [], events: [venta('ticket-a-la-vez')] };

      const resultados = await Promise.all(
        Array.from({ length: 6 }, () => escribir(lote)),
      );

      const creados = resultados.reduce((n, r) => n + r.stats.eventsCreated, 0);
      expect(creados).toBe(1);

      const filas = await prisma.businessEvent.findMany({
        where: { organizationId: org.orgId },
      });
      expect(filas).toHaveLength(1);
    });

    it('dos ventanas de sondeo solapadas no duplican lo que comparten', async () => {
      await escribir({
        entities: [],
        events: [venta('t-1'), venta('t-2'), venta('t-3')],
      });

      const solape = await escribir({
        entities: [],
        events: [venta('t-2'), venta('t-3'), venta('t-4'), venta('t-5')],
      });

      expect(solape.stats.eventsCreated).toBe(2);
      expect(solape.stats.eventsSkippedDuplicate).toBe(2);
      expect(
        await prisma.businessEvent.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(5);
    });

    it('el MISMO identificador en clases distintas son hechos distintos', async () => {
      await escribir({
        entities: [],
        events: [
          venta('pedido-9'),
          {
            kind: BusinessEventKind.ORDER_PLACED,
            externalId: 'pedido-9',
            occurredAt: new Date('2026-10-17T21:00:00.000Z'),
          },
        ],
      });

      expect(
        await prisma.businessEvent.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(2);
    });
  });

  describe('maestros', () => {
    it('crea el maestro la primera vez y lo actualiza la siguiente', async () => {
      const entidad = {
        kind: BusinessEntityKind.CUSTOMER,
        externalId: 'cli-1',
        displayName: 'Panadería Ruiz',
      };

      const primera = await escribir({ entities: [entidad], events: [] });
      const segunda = await escribir({
        entities: [{ ...entidad, displayName: 'Panadería Ruiz SL' }],
        events: [],
      });

      expect(primera.stats.entitiesCreated).toBe(1);
      expect(segunda.stats.entitiesCreated).toBe(0);
      expect(segunda.stats.entitiesUpdated).toBe(1);

      const filas = await prisma.businessEntity.findMany({
        where: { organizationId: org.orgId },
      });
      expect(filas).toHaveLength(1);
      expect(filas[0]?.displayName).toBe('Panadería Ruiz SL');
    });

    it('liga el hecho a un maestro que llega en el MISMO lote', async () => {
      await escribir({
        entities: [
          {
            kind: BusinessEntityKind.CUSTOMER,
            externalId: 'cli-7',
            displayName: 'Bar Pepe',
          },
        ],
        events: [
          venta('t-con-cliente', {
            subject: { kind: BusinessEntityKind.CUSTOMER, externalId: 'cli-7' },
          }),
        ],
      });

      const hecho = await prisma.businessEvent.findFirstOrThrow({
        where: { organizationId: org.orgId },
        include: { subject: true },
      });
      expect(hecho.subject?.displayName).toBe('Bar Pepe');
    });

    it('liga el hecho a un maestro de una pasada ANTERIOR', async () => {
      await escribir({
        entities: [
          {
            kind: BusinessEntityKind.CUSTOMER,
            externalId: 'cli-8',
            displayName: 'Bar Luis',
          },
        ],
        events: [],
      });

      await escribir({
        entities: [],
        events: [
          venta('t-despues', {
            subject: { kind: BusinessEntityKind.CUSTOMER, externalId: 'cli-8' },
          }),
        ],
      });

      const hecho = await prisma.businessEvent.findFirstOrThrow({
        where: { organizationId: org.orgId },
        include: { subject: true },
      });
      expect(hecho.subject?.displayName).toBe('Bar Luis');
    });

    /**
     * No saber a qué cliente pertenece una venta no la convierte en una venta que no
     * ocurrió: sigue contando para el total y para la franja horaria.
     */
    it('un maestro desconocido deja el hecho SIN sujeto, no lo descarta', async () => {
      const resultado = await escribir({
        entities: [],
        events: [
          venta('t-huerfano', {
            subject: {
              kind: BusinessEntityKind.CUSTOMER,
              externalId: 'no-existe',
            },
          }),
        ],
      });

      expect(resultado.stats.eventsCreated).toBe(1);
      const hecho = await prisma.businessEvent.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });
      expect(hecho.subjectId).toBeNull();
    });
  });

  describe('un dato malo no tumba el lote', () => {
    it('escribe los buenos, descarta el malo y dice por qué', async () => {
      const resultado = await escribir({
        entities: [],
        events: [
          venta('bueno-1'),
          // Importe sin moneda: no se puede sumar con nada.
          { ...venta('malo'), currency: null },
          venta('bueno-2'),
        ],
      });

      expect(resultado.stats.eventsCreated).toBe(2);
      expect(resultado.stats.eventsRejected).toBe(1);
      expect(resultado.rejections[0]?.externalId).toBe('malo');
      expect(resultado.rejections[0]?.reason).toMatch(/juntos/i);
    });
  });

  describe('aislamiento entre empresas', () => {
    it('una empresa no ve los hechos de otra aunque compartan identificadores', async () => {
      const otra = await createTestOrg('facts-vecina');
      await escribir({ entities: [], events: [venta('mismo-id')] });
      await registro.record({
        organizationId: otra.orgId,
        connectorId: CONECTOR,
        batch: { entities: [], events: [venta('mismo-id')] },
      });

      const mios = await prisma.businessEvent.findMany({
        where: { organizationId: org.orgId },
      });
      const suyos = await prisma.businessEvent.findMany({
        where: { organizationId: otra.orgId },
      });

      expect(mios).toHaveLength(1);
      expect(suyos).toHaveLength(1);
      expect(mios[0]?.id).not.toBe(suyos[0]?.id);

      await prisma.businessEvent.deleteMany({
        where: { organizationId: otra.orgId },
      });
      await destroyTestOrg(otra);
    });

    /**
     * La clave foránea COMPUESTA. Con una clave simple esto se escribiría sin más, y el
     * hecho de una empresa colgaría del cliente de otra.
     */
    it('la BASE impide ligar un hecho al maestro de otra empresa', async () => {
      const otra = await createTestOrg('facts-ajena');
      const ajeno = await prisma.businessEntity.create({
        data: {
          organizationId: otra.orgId,
          connectorId: CONECTOR,
          kind: BusinessEntityKind.CUSTOMER,
          externalId: 'cli-ajeno',
          displayName: 'De otra empresa',
        },
      });

      await expect(
        prisma.businessEvent.create({
          data: {
            organizationId: org.orgId,
            connectorId: CONECTOR,
            kind: BusinessEventKind.SALE_RECORDED,
            externalId: 'intruso',
            occurredAt: new Date(),
            subjectId: ajeno.id,
          },
        }),
      ).rejects.toThrow();

      await prisma.businessEntity.deleteMany({
        where: { organizationId: otra.orgId },
      });
      await destroyTestOrg(otra);
    });
  });

  describe('el ciclo de un pedido', () => {
    it('devuelve los hechos del pedido en orden, y solo los suyos', async () => {
      const t = (min: number) =>
        new Date(`2026-10-17T21:${String(min).padStart(2, '0')}:00.000Z`);

      await escribir({
        entities: [],
        events: [
          {
            kind: BusinessEventKind.ORDER_ITEM_READY,
            externalId: 'e-3',
            occurredAt: t(19),
            correlationId: 'cmd-1',
          },
          {
            kind: BusinessEventKind.ORDER_PLACED,
            externalId: 'e-1',
            occurredAt: t(2),
            correlationId: 'cmd-1',
          },
          {
            kind: BusinessEventKind.ORDER_SENT_TO_KITCHEN,
            externalId: 'e-2',
            occurredAt: t(4),
            correlationId: 'cmd-1',
          },
          {
            kind: BusinessEventKind.ORDER_PLACED,
            externalId: 'otro',
            occurredAt: t(5),
            correlationId: 'cmd-2',
          },
        ],
      });

      const ciclo = await registro.timeline({
        organizationId: org.orgId,
        correlationId: 'cmd-1',
      });

      expect(ciclo.map((e) => e.externalId)).toEqual(['e-1', 'e-2', 'e-3']);
      // Y la resta que sostiene toda métrica de cocina:
      const preparacion =
        ciclo[2].occurredAt.getTime() - ciclo[1].occurredAt.getTime();
      expect(preparacion).toBe(15 * 60 * 1000);
    });
  });

  describe('escritura dentro de una transacción ajena', () => {
    it('los hechos se deshacen si la transacción que los escribió se deshace', async () => {
      await expect(
        db.$transaction(async (tx) => {
          await registro.record(
            {
              organizationId: org.orgId,
              connectorId: CONECTOR,
              batch: { entities: [], events: [venta('transaccional')] },
            },
            tx,
          );
          throw new Error('falló al avanzar el marcador');
        }),
      ).rejects.toThrow('falló al avanzar el marcador');

      expect(
        await prisma.businessEvent.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(0);
    });
  });
});

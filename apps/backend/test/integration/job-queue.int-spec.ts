import { JobStatus } from '@businessbrain/database';
import { PostgresJobQueue } from '../../src/jobs/infrastructure/postgres-job-queue';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  createTestOrg,
  destroyTestOrg,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * La cola durable, contra Postgres de verdad — Fase 9A.
 *
 * Ningún doble puede demostrar lo que se comprueba aquí, porque todo depende del motor:
 *
 * - que dos procesos **no** se repartan el mismo trabajo (`FOR UPDATE SKIP LOCKED`),
 * - que la clave de deduplicación aguante una carrera entre dos encolados simultáneos,
 * - que un trabajo abandonado por un proceso muerto vuelva a estar disponible,
 * - que encolar quepa dentro de la transacción de quien lo pide, y se deshaga con ella.
 *
 * Esa última es la razón por la que la cola vive en Postgres y no en Redis
 * (FASE-9A-9B-ARQUITECTURA-CERRADA.md §3.2). Si deja de cumplirse, la decisión pierde su
 * fundamento.
 */
describe('Cola de trabajo diferido (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let cola: PostgresJobQueue;

  beforeEach(async () => {
    org = await createTestOrg('job-queue-int');
    cola = new PostgresJobQueue(db);
  });

  afterEach(async () => {
    await prisma.job.deleteMany({ where: { organizationId: org.orgId } });
    await destroyTestOrg(org);
  });

  const encolar = (extra: Record<string, unknown> = {}) =>
    cola.enqueue({
      kind: 'prueba.trabajo',
      organizationId: org.orgId,
      ...extra,
    });

  describe('reparto entre procesos', () => {
    it('dos procesos NUNCA reclaman el mismo trabajo', async () => {
      for (let i = 0; i < 10; i++) await encolar({ payload: { i } });

      // Simultáneos a propósito: es la condición que `SKIP LOCKED` tiene que resolver.
      const [a, b] = await Promise.all([
        cola.claim('proceso-a', 10),
        cola.claim('proceso-b', 10),
      ]);

      const ids = [...a, ...b].map((j) => j.id);
      expect(ids).toHaveLength(10);
      expect(new Set(ids).size).toBe(10);
    });

    it('respeta el límite pedido y sirve lo más vencido primero', async () => {
      const ahora = Date.now();
      for (let i = 0; i < 5; i++) {
        await encolar({
          payload: { orden: i },
          runAt: new Date(ahora - (5 - i) * 60_000),
        });
      }

      const reclamados = await cola.claim('p', 2);

      expect(reclamados).toHaveLength(2);
      expect((reclamados[0]?.payload as { orden: number }).orden).toBe(0);
    });

    it('no reclama un trabajo cuyo turno aún no ha llegado', async () => {
      await encolar({ runAt: new Date(Date.now() + 60 * 60_000) });

      expect(await cola.claim('p', 10)).toHaveLength(0);
    });

    it('cuenta el intento al reclamar, no al fallar', async () => {
      await encolar();

      const [reclamado] = await cola.claim('p', 1);

      expect(reclamado?.attempts).toBe(1);
    });
  });

  describe('deduplicación', () => {
    it('dos encolados con la misma clave son uno solo', async () => {
      const primero = await encolar({ dedupeKey: 'sync:fuente-1' });
      const segundo = await encolar({ dedupeKey: 'sync:fuente-1' });

      expect(primero.created).toBe(true);
      expect(segundo.created).toBe(false);
      expect(segundo.id).toBe(primero.id);
    });

    it('aguanta la carrera entre encolados simultáneos', async () => {
      const resultados = await Promise.all(
        Array.from({ length: 8 }, () => encolar({ dedupeKey: 'a-la-vez' })),
      );

      const creados = resultados.filter((r) => r.created);
      expect(creados).toHaveLength(1);
      expect(new Set(resultados.map((r) => r.id)).size).toBe(1);
    });

    it('cumplido el trabajo, la clave vuelve a estar libre', async () => {
      const primero = await encolar({ dedupeKey: 'ciclo' });
      await cola.succeed(primero.id);

      const segundo = await encolar({ dedupeKey: 'ciclo' });

      expect(segundo.created).toBe(true);
      expect(segundo.id).not.toBe(primero.id);
    });

    /**
     * El índice es parcial justamente por esto: si un fallo permanente bloqueara la clave
     * para siempre, ese conector no podría volver a sincronizar nunca.
     */
    it('un trabajo MUERTO no impide volver a encolar lo mismo', async () => {
      const muerto = await encolar({ dedupeKey: 'revivible' });
      await cola.bury(muerto.id, 'se acabaron los intentos');

      const nuevo = await encolar({ dedupeKey: 'revivible' });

      expect(nuevo.created).toBe(true);
      expect(nuevo.id).not.toBe(muerto.id);
    });
  });

  describe('recuperación ante caída', () => {
    it('recupera un trabajo abandonado por un proceso muerto', async () => {
      await encolar();
      const [reclamado] = await cola.claim('proceso-que-muere', 1);

      // El proceso cayó aquí: la fila se queda en RUNNING, sin nadie detrás.
      expect(await cola.claim('otro', 10)).toHaveLength(0);

      // Pasado el arrendamiento, otro proceso puede recogerlo.
      const tras = new Date(Date.now() + 11 * 60_000);
      const recuperados = await cola.claim('proceso-sano', 10, tras);

      expect(recuperados.map((j) => j.id)).toEqual([reclamado?.id]);
      expect(recuperados[0]?.attempts).toBe(2);
    });

    it('un trabajo en curso dentro de su arrendamiento no se le quita a nadie', async () => {
      await encolar();
      await cola.claim('en-marcha', 1);

      const otro = await cola.claim(
        'entrometido',
        10,
        new Date(Date.now() + 60_000),
      );

      expect(otro).toHaveLength(0);
    });
  });

  describe('ciclo de vida', () => {
    it('cumplir borra la fila: la cola no es un libro de cuentas', async () => {
      const { id } = await encolar();
      await cola.succeed(id);

      expect(await prisma.job.findUnique({ where: { id } })).toBeNull();
    });

    it('reprogramar libera el dueño y guarda el motivo', async () => {
      const { id } = await encolar();
      await cola.claim('p', 1);
      const cuando = new Date(Date.now() + 30_000);

      await cola.reschedule(id, cuando, 'el proveedor no responde');

      const fila = await prisma.job.findUniqueOrThrow({ where: { id } });
      expect(fila.status).toBe(JobStatus.FAILED);
      expect(fila.lockedBy).toBeNull();
      expect(fila.lastError).toBe('el proveedor no responde');
    });

    it('enterrar conserva la fila, que es de las que hay que mirar', async () => {
      const { id } = await encolar();
      await cola.bury(id, 'nadie sabe atenderlo');

      const fila = await prisma.job.findUniqueOrThrow({ where: { id } });
      expect(fila.status).toBe(JobStatus.DEAD);
      expect(fila.lockedBy).toBeNull();
      // Y deja de estorbar: no vuelve a reclamarse.
      expect(await cola.claim('p', 10)).toHaveLength(0);
    });

    it('acota un error enorme en vez de guardarlo entero', async () => {
      const { id } = await encolar();
      await cola.bury(id, 'x'.repeat(50_000));

      const fila = await prisma.job.findUniqueOrThrow({ where: { id } });
      expect(fila.lastError!.length).toBeLessThan(2_100);
    });
  });

  /**
   * La razón de ser de tener la cola en la misma base que los datos.
   */
  describe('encolar dentro de una transacción ajena', () => {
    it('el trabajo se deshace si la transacción que lo encoló se deshace', async () => {
      await expect(
        db.$transaction(async (tx) => {
          await cola.enqueue(
            {
              kind: 'prueba.trabajo',
              organizationId: org.orgId,
              dedupeKey: 'transaccional',
            },
            tx,
          );
          throw new Error('algo falló después de encolar');
        }),
      ).rejects.toThrow('algo falló después de encolar');

      const vivos = await prisma.job.findMany({
        where: { dedupeKey: 'transaccional' },
      });
      expect(vivos).toHaveLength(0);
    });

    it('y queda encolado si la transacción se confirma', async () => {
      await db.$transaction(async (tx) => {
        await cola.enqueue(
          {
            kind: 'prueba.trabajo',
            organizationId: org.orgId,
            dedupeKey: 'confirmada',
          },
          tx,
        );
      });

      const vivos = await prisma.job.findMany({
        where: { dedupeKey: 'confirmada' },
      });
      expect(vivos).toHaveLength(1);
    });
  });

  describe('aislamiento entre empresas', () => {
    it('borrar la empresa se lleva sus trabajos y no toca los de otra', async () => {
      const otra = await createTestOrg('job-queue-vecina');
      await encolar();
      await cola.enqueue({
        kind: 'prueba.trabajo',
        organizationId: otra.orgId,
      });

      await prisma.job.deleteMany({ where: { organizationId: org.orgId } });
      await destroyTestOrg(org);
      org = await createTestOrg('job-queue-int');

      const supervivientes = await prisma.job.findMany({
        where: { organizationId: otra.orgId },
      });
      expect(supervivientes).toHaveLength(1);

      await prisma.job.deleteMany({ where: { organizationId: otra.orgId } });
      await destroyTestOrg(otra);
    });
  });
});

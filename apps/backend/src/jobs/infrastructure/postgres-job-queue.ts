import { Injectable } from '@nestjs/common';
import { JobStatus, Prisma } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  EnqueueParams,
  EnqueueResult,
  JobQueuePort,
} from '../domain/ports/job-queue.port';

/** Una fila de la cola, tal como la devuelve la reclamación. */
export interface ClaimedJob {
  id: string;
  kind: string;
  organizationId: string | null;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

/**
 * La cola, sobre Postgres.
 *
 * ## Cómo se reparte el trabajo entre varios procesos
 *
 * Con `FOR UPDATE SKIP LOCKED`. Cada proceso pide las filas vencidas y Postgres le entrega
 * solo las que nadie más tiene cogidas en ese instante, saltándose las ocupadas en vez de
 * esperarlas. Dos instancias del backend nunca ejecutan el mismo trabajo y ninguna se queda
 * bloqueada detrás de la otra.
 *
 * Es el mismo criterio que ya usa el reloj de automatizaciones: **la corrección bajo
 * concurrencia la da la base de datos, no un cerrojo aplicativo.**
 *
 * ## Cómo se recupera lo que quedó colgado
 *
 * Un proceso que muere con un trabajo reclamado lo deja en RUNNING para siempre. Por eso la
 * reclamación también recoge los RUNNING cuyo arrendamiento ha vencido. El precio es que un
 * trabajo muy lento puede ejecutarse dos veces, y por eso el arrendamiento es largo y los
 * manejadores deben ser idempotentes —que es, además, lo que esta fase exige de todos modos.
 */
@Injectable()
export class PostgresJobQueue implements JobQueuePort {
  /**
   * Cuánto puede tener un proceso un trabajo antes de que otro lo dé por abandonado.
   *
   * Generoso a propósito: recuperar demasiado pronto duplica ejecuciones de trabajos que
   * simplemente iban lentos, y eso es peor que tardar unos minutos en recuperar una caída
   * de verdad.
   */
  private static readonly LEASE_MS = 10 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(
    params: EnqueueParams,
    tx?: Prisma.TransactionClient,
  ): Promise<EnqueueResult> {
    const client = tx ?? this.prisma;

    const data = {
      kind: params.kind,
      payload: params.payload ?? {},
      organizationId: params.organizationId ?? null,
      dedupeKey: params.dedupeKey ?? null,
      runAt: params.runAt ?? new Date(),
      ...(params.maxAttempts === undefined
        ? {}
        : { maxAttempts: params.maxAttempts }),
    };

    if (!params.dedupeKey) {
      const created = await client.job.create({ data, select: { id: true } });
      return { id: created.id, created: true };
    }

    /*
     * Con clave de deduplicación se intenta crear y se trata el choque, en vez de mirar
     * antes si existe. Mirar-y-luego-crear tiene una carrera entre ambas: dos procesos ven
     * que no hay nada y los dos encolan. Aquí el índice único parcial decide, que es lo
     * único que no puede equivocarse.
     */
    try {
      const created = await client.job.create({ data, select: { id: true } });
      return { id: created.id, created: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const vivo = await client.job.findFirst({
          where: {
            dedupeKey: params.dedupeKey,
            status: { not: JobStatus.DEAD },
          },
          select: { id: true },
        });
        // Si ya no está, es que se cumplió entre el choque y esta lectura: el trabajo que
        // pedíamos ya se ha hecho, así que no hay nada que encolar ni nada que informar.
        if (vivo) return { id: vivo.id, created: false };
        const reintento = await client.job.create({
          data,
          select: { id: true },
        });
        return { id: reintento.id, created: true };
      }
      throw error;
    }
  }

  /**
   * Reclama hasta `limit` trabajos para este proceso.
   *
   * SQL en crudo porque `FOR UPDATE SKIP LOCKED` no se puede expresar con el cliente, y es
   * justamente la cláusula que hace correcto el reparto.
   */
  async claim(
    worker: string,
    limit: number,
    now: Date = new Date(),
  ): Promise<ClaimedJob[]> {
    const leaseHorizon = new Date(now.getTime() - PostgresJobQueue.LEASE_MS);

    return this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE "Job" AS j
         SET "status"   = 'RUNNING',
             "lockedAt" = ${now},
             "lockedBy" = ${worker},
             "attempts" = j."attempts" + 1,
             "updatedAt" = ${now}
       WHERE j."id" IN (
         SELECT c."id" FROM "Job" AS c
          WHERE (c."status" IN ('PENDING', 'FAILED') AND c."runAt" <= ${now})
             OR (c."status" = 'RUNNING' AND c."lockedAt" < ${leaseHorizon})
          ORDER BY c."runAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
       )
   RETURNING j."id", j."kind", j."organizationId", j."payload",
             j."attempts", j."maxAttempts"`;
  }

  /** Cumplido: la fila desaparece. La cola es una lista de tareas, no un libro de cuentas. */
  async succeed(id: string): Promise<void> {
    await this.prisma.job.delete({ where: { id } });
  }

  /** Falló y volverá a intentarse cuando venza `runAt`. */
  async reschedule(id: string, runAt: Date, error: string): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: {
        status: JobStatus.FAILED,
        runAt,
        lastError: truncar(error),
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  /** Agotado o inatendible. Se conserva: es de los que hay que mirar. */
  async bury(id: string, error: string): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: {
        status: JobStatus.DEAD,
        lastError: truncar(error),
        lockedAt: null,
        lockedBy: null,
      },
    });
  }
}

/**
 * El mensaje de error, acotado.
 *
 * Un proveedor puede devolver un HTML de varios megabytes como cuerpo de error. Guardarlo
 * entero engorda la tabla más consultada del sistema y no añade nada: lo que diagnostica
 * está al principio.
 */
function truncar(mensaje: string, limite = 2_000): string {
  return mensaje.length <= limite ? mensaje : `${mensaje.slice(0, limite)}…`;
}

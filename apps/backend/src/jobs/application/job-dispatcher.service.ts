import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { backoffDelayMs, hasExhaustedAttempts } from '../domain/job-backoff';
import type { JobContext } from '../domain/ports/job-queue.port';
import {
  PostgresJobQueue,
  type ClaimedJob,
} from '../infrastructure/postgres-job-queue';
import { JobHandlerRegistry } from './job-handler-registry';

/**
 * El tic que vacía la cola.
 *
 * ## Qué garantiza
 *
 * - **Nadie se queda colgado.** Un trabajo reclamado por un proceso que muere vuelve a estar
 *   disponible al vencer su arrendamiento.
 * - **Un fallo no se lleva por delante el resto.** Cada trabajo se ejecuta dentro de su
 *   propio `try`: una empresa con un conector roto no puede dejar sin servicio a las demás.
 *   Es la misma regla que ya aplica el reloj de automatizaciones.
 * - **Nada se reintenta para siempre.** Al agotar los intentos el trabajo muere, con su
 *   último error guardado.
 * - **Un trabajo que nadie sabe atender muere en el acto.** Reintentarlo cinco veces no va a
 *   hacer que aparezca su manejador, y mientras tanto ocupa turno.
 *
 * ## Por qué en serie y no en paralelo
 *
 * Porque es suficiente y se entiende. El tope por tic acota cuánto dura una pasada, y si un
 * día hace falta más capacidad la respuesta correcta es otra instancia del backend —que la
 * reclamación ya soporta— y no concurrencia dentro de este bucle, que solo añadiría formas
 * nuevas de equivocarse.
 */
@Injectable()
export class JobDispatcherService {
  private readonly logger = new Logger(JobDispatcherService.name);

  /**
   * Cota por tic. Un pico no puede acaparar el proceso: lo que no entre, entra en el
   * siguiente, que está a un minuto.
   */
  private static readonly MAX_PER_TICK = 20;

  /**
   * Quién es este proceso. Se genera al arrancar y solo sirve para diagnosticar: permite
   * ver en la tabla qué instancia tiene cada trabajo.
   */
  private readonly worker = `worker-${randomUUID().slice(0, 8)}`;

  constructor(
    private readonly queue: PostgresJobQueue,
    private readonly registry: JobHandlerRegistry,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    await this.drain();
  }

  /**
   * Ejecuta lo que haya vencido.
   *
   * Público para poder comprobarlo sin esperar a un tic real, igual que
   * `runDueAutomations`.
   *
   * @returns identificadores de los trabajos que ESTE proceso llegó a reclamar.
   */
  async drain(now: Date = new Date()): Promise<string[]> {
    const claimed = await this.queue.claim(
      this.worker,
      JobDispatcherService.MAX_PER_TICK,
      now,
    );

    for (const job of claimed) {
      await this.run(job, now);
    }

    return claimed.map((job) => job.id);
  }

  private async run(job: ClaimedJob, now: Date): Promise<void> {
    const handler = this.registry.get(job.kind);

    if (!handler) {
      // Fallo cerrado: se entierra con el motivo explícito. Insistir no haría aparecer el
      // manejador y el trabajo seguiría ocupando turno en cada tic.
      this.logger.error(
        `Nadie sabe atender el trabajo "${job.kind}" (${job.id}). Se entierra.`,
      );
      await this.queue.bury(
        job.id,
        `No hay manejador registrado para "${job.kind}". ` +
          `Registrados: ${this.registry.kinds().join(', ') || 'ninguno'}`,
      );
      return;
    }

    try {
      await handler.handle(toContext(job));
      await this.queue.succeed(job.id);
    } catch (error) {
      await this.onFailure(job, error, now);
    }
  }

  private async onFailure(
    job: ClaimedJob,
    error: unknown,
    now: Date,
  ): Promise<void> {
    const mensaje = error instanceof Error ? error.message : String(error);

    try {
      if (hasExhaustedAttempts(job.attempts, job.maxAttempts)) {
        this.logger.error(
          `El trabajo ${job.kind} (${job.id}) agotó sus ${job.maxAttempts} intentos: ${mensaje}`,
        );
        await this.queue.bury(job.id, mensaje);
        return;
      }

      const runAt = new Date(now.getTime() + backoffDelayMs(job.attempts));
      this.logger.warn(
        `El trabajo ${job.kind} (${job.id}) falló en el intento ` +
          `${job.attempts}/${job.maxAttempts}; se reintenta a las ${runAt.toISOString()}: ${mensaje}`,
      );
      await this.queue.reschedule(job.id, runAt, mensaje);
    } catch (falloAlRegistrar) {
      /*
       * Llegar aquí significa que falló la base de datos al anotar el fallo. El trabajo
       * queda en RUNNING y lo recuperará el arrendamiento: es exactamente el caso para el
       * que existe. Lo único que no puede pasar es que esto tumbe el tic entero y deje sin
       * servicio a los demás trabajos.
       */
      this.logger.error(
        `No se pudo registrar el fallo del trabajo ${job.id}; ` +
          `quedará para la recuperación por arrendamiento: ` +
          `${(falloAlRegistrar as Error).message}`,
      );
    }
  }
}

function toContext(job: ClaimedJob): JobContext {
  return {
    id: job.id,
    kind: job.kind,
    organizationId: job.organizationId,
    payload: job.payload,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
  };
}

import type { Prisma } from '@businessbrain/database';

/**
 * La cola de trabajo diferido, vista por quien la usa.
 *
 * Un puerto, y no el servicio concreto, para que el motor pueda cambiarse sin tocar a nadie:
 * hoy es Postgres (ver FASE-9A-9B-ARQUITECTURA-CERRADA.md §3.2) y mañana podría no serlo.
 */

export const JOB_QUEUE_PORT = Symbol('JOB_QUEUE_PORT');

export interface EnqueueParams {
  /** Qué sabe atenderlo. Debe existir un manejador registrado con esta clave. */
  kind: string;
  /** Datos del trabajo. **Nunca secretos**: se guardan en claro y se leen al diagnosticar. */
  payload?: Prisma.InputJsonValue;
  /** Empresa a la que pertenece. Nulo solo en tareas del propio sistema. */
  organizationId?: string | null;
  /** Evita duplicarlo mientras siga vivo. Dos encolados con la misma clave son uno. */
  dedupeKey?: string;
  /** No antes de este instante. Por defecto, ya. */
  runAt?: Date;
  maxAttempts?: number;
}

export interface EnqueueResult {
  id: string;
  /** `false` cuando ya había un trabajo vivo con la misma `dedupeKey`. */
  created: boolean;
}

export interface JobQueuePort {
  /**
   * Encola un trabajo.
   *
   * `tx` existe por la razón de ser de esta cola: encolar y escribir lo que justifica el
   * encolado tienen que poder caber en la misma transacción. Sin ese parámetro, la ventaja
   * de tener la cola en la base de datos se pierde entera.
   */
  enqueue(
    params: EnqueueParams,
    tx?: Prisma.TransactionClient,
  ): Promise<EnqueueResult>;
}

/** Lo que un manejador recibe. Deliberadamente escueto: lo demás no le incumbe. */
export interface JobContext {
  id: string;
  kind: string;
  organizationId: string | null;
  payload: unknown;
  /** Intentos consumidos, este incluido. Permite actuar distinto en el último. */
  attempts: number;
  maxAttempts: number;
}

/**
 * Quien sabe hacer un tipo de trabajo.
 *
 * Contrato: **lanzar significa reintentar**. Si un fallo no es recuperable —un dato
 * imposible, una empresa que ya no existe— el manejador debe terminar sin lanzar y dejar
 * constancia por su cuenta. Reintentar cinco veces algo que nunca va a salir bien solo
 * retrasa cinco veces el diagnóstico.
 */
export interface JobHandler {
  readonly kind: string;
  handle(job: JobContext): Promise<void>;
}

export const JOB_HANDLER = Symbol('JOB_HANDLER');

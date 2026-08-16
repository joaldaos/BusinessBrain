/**
 * `SchedulerPort` — UNDERSTANDING_ENGINE_DESIGN.md §13, BUSINESSBRAIN_MIGRATION_PLAN.md §10.
 *
 * Abstracción de **qué dispara** un trabajo periódico, desacoplada de la tecnología concreta.
 * §13 lo define exactamente así, y por eso la elección de adaptador es reversible sin tocar
 * el dominio: hoy un temporizador en proceso, mañana una cola distribuida.
 *
 * ## Lo único que el dominio necesita del reloj
 *
 * Saber cuándo toca la próxima vez. Nada más. Calcularlo exige interpretar cron y zonas
 * horarias —con su horario de verano y sus saltos—, y eso es conocimiento de librería, no de
 * dominio: por eso vive detrás de un puerto en vez de dentro del modelo.
 */

export const SCHEDULER_PORT = Symbol('SCHEDULER_PORT');

export interface SchedulerPort {
  /**
   * Próximo instante en que una expresión debe dispararse, a partir de `from`.
   *
   * Devuelve `null` si la expresión no produce ninguna ejecución futura. El llamante decide
   * qué hacer con eso; el puerto no lo interpreta.
   */
  nextOccurrence(params: {
    cron: string;
    timezone: string;
    from: Date;
  }): Date | null;
}

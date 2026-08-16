import { Injectable, Logger } from '@nestjs/common';
import { CronJob } from 'cron';
import type { SchedulerPort } from '../domain/ports/scheduler.port';

/**
 * Adaptador de calendario sobre `cron` — implementa `SchedulerPort` (§13).
 *
 * Toda la dependencia de la librería vive aquí. El dominio solo sabe preguntar cuándo toca la
 * próxima vez; que eso implique interpretar cron, zonas horarias IANA y los saltos de horario
 * de verano es un detalle de esta capa.
 *
 * `CronJob` se construye SIN arrancarlo: se usa como calculadora, no como temporizador. Quien
 * decide cuándo se ejecuta algo es la reclamación en Postgres, no un temporizador en memoria
 * de un proceso concreto — si fuera al revés, cada instancia del backend dispararía por su
 * cuenta lo mismo.
 */
@Injectable()
export class CronSchedulerAdapter implements SchedulerPort {
  private readonly logger = new Logger(CronSchedulerAdapter.name);

  nextOccurrence(params: {
    cron: string;
    timezone: string;
    from: Date;
  }): Date | null {
    try {
      const job = new CronJob(
        params.cron,
        () => undefined,
        null,
        false,
        params.timezone,
      );
      const next = job.nextDate();
      const at = next.toJSDate();

      // `from` puede ser futuro respecto de ahora (se reprograma tras ejecutar). Se avanza
      // hasta rebasarlo en lugar de devolver una fecha ya pasada, que se reclamaría de
      // inmediato y produciría un bucle de disparos.
      if (at.getTime() > params.from.getTime()) return at;

      const [siguiente] = job.nextDates(2).slice(1);
      return siguiente ? siguiente.toJSDate() : null;
    } catch (error) {
      // Una expresión inválida no debe tumbar el barrido de todas las organizaciones. Se
      // valida al crearla (`parseScheduleTrigger`), así que llegar aquí ya es anómalo.
      this.logger.error(
        `Expresión de calendario inservible ("${params.cron}", ${params.timezone}): ` +
          `${(error as Error).message}`,
      );
      return null;
    }
  }
}

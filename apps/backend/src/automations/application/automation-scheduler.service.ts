import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AutomationStatus,
  AutomationTriggerType,
  type Automation,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { parseScheduleTrigger } from '../domain/automation-plan';
import {
  SCHEDULER_PORT,
  type SchedulerPort,
} from '../domain/ports/scheduler.port';
import { RunAutomationUseCase } from './run-automation.use-case';

/**
 * El reloj — BUSINESSBRAIN_MIGRATION_PLAN.md §10 (fase 6), `SchedulerPort` (§13).
 *
 * Es la pieza que hacía falta para que BusinessBrain comprenda por su cuenta. Hasta aquí el
 * motor solo razonaba cuando alguien pulsaba un botón; la memoria de la creencia (Fase 7)
 * existía sin que casi nada la alimentara, porque una trayectoria necesita ejecuciones
 * repetidas a lo largo del tiempo.
 *
 * ## Por qué la reclamación es una escritura condicional y no un temporizador
 *
 * Con varias instancias del backend, un temporizador en memoria dispararía la misma
 * automatización en cada proceso. Aquí el tic solo pregunta "¿qué ha vencido?" y **reclama
 * cada fila con un `updateMany` condicionado a que siga vencida**, moviendo su `nextRunAt` a
 * la siguiente ocurrencia en el mismo movimiento. Quien consigue la escritura ejecuta; el
 * resto se encuentra la fila ya movida y sigue. Es el mismo criterio que la supersesión de la
 * Fase 7 y la resolución de recomendaciones: la corrección la da Postgres, no un cerrojo
 * aplicativo.
 *
 * Reprogramar ANTES de ejecutar, y no después, es deliberado: si el proceso muere a mitad de
 * la ejecución, la automatización vuelve a intentarlo en su siguiente hueco en vez de quedar
 * reclamada para siempre. Se prefiere saltarse una ejecución a dejarla colgada.
 *
 * ## Es el único barrido que cruza organizaciones
 *
 * A propósito, y por eso no toma ningún alcance: no lee comprensión ni conocimiento. Solo mira
 * fechas y delega en `RunAutomationUseCase`, que ya ejecuta dentro de un solo tenant.
 */
@Injectable()
export class AutomationSchedulerService {
  private readonly logger = new Logger(AutomationSchedulerService.name);

  /** Cota por tic: un pico de vencidas no puede acaparar el proceso indefinidamente. */
  private static readonly MAX_PER_TICK = 25;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: RunAutomationUseCase,
    @Inject(SCHEDULER_PORT) private readonly scheduler: SchedulerPort,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    await this.runDueAutomations();
  }

  /**
   * Ejecuta lo vencido. Público para poder verificarlo sin esperar a un tic real.
   *
   * @returns identificadores de las automatizaciones que ESTE proceso llegó a reclamar.
   */
  async runDueAutomations(now: Date = new Date()): Promise<string[]> {
    const due = await this.prisma.automation.findMany({
      where: {
        status: AutomationStatus.ACTIVE,
        triggerType: AutomationTriggerType.SCHEDULE,
        nextRunAt: { not: null, lte: now },
      },
      orderBy: { nextRunAt: 'asc' },
      take: AutomationSchedulerService.MAX_PER_TICK,
    });

    const executed: string[] = [];

    for (const automation of due) {
      const claimed = await this.claim(automation, now);
      if (!claimed) continue;

      executed.push(automation.id);
      try {
        await this.runner.execute(automation);
      } catch (error) {
        // `RunAutomationUseCase` ya registra sus propios fallos. Llegar aquí significa que
        // falló al registrarlos, y aun así el barrido debe seguir con las demás: una
        // organización con un problema no puede dejar sin reloj a las otras.
        this.logger.error(
          `Fallo no controlado ejecutando la automatización ${automation.id}: ` +
            `${(error as Error).message}`,
        );
      }
    }

    return executed;
  }

  /**
   * Reclama la automatización moviendo su próximo vencimiento.
   *
   * La condición `nextRunAt` = el valor que se leyó es lo que hace la operación segura: si
   * otro proceso ya la movió, el `updateMany` afecta a cero filas y este se retira.
   */
  private async claim(automation: Automation, now: Date): Promise<boolean> {
    const nextRunAt = this.computeNext(automation, now);

    const claimed = await this.prisma.automation.updateMany({
      where: {
        id: automation.id,
        status: AutomationStatus.ACTIVE,
        nextRunAt: automation.nextRunAt,
      },
      data: { nextRunAt },
    });

    return claimed.count === 1;
  }

  /**
   * Siguiente vencimiento, o `null` si la expresión dejó de producir ejecuciones.
   *
   * Una expresión inservible detiene ESA automatización —`nextRunAt` nulo, nunca se
   * reclama— sin tumbar el barrido. Se valida al crearla, así que llegar aquí ya es anómalo.
   */
  private computeNext(automation: Automation, now: Date): Date | null {
    try {
      const schedule = parseScheduleTrigger(automation.triggerConfig);
      return this.scheduler.nextOccurrence({
        cron: schedule.cron,
        timezone: schedule.timezone,
        from: now,
      });
    } catch (error) {
      this.logger.error(
        `La automatización ${automation.id} tiene un calendario inservible y deja de ` +
          `programarse: ${(error as Error).message}`,
      );
      return null;
    }
  }
}

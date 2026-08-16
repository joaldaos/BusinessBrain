import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { UnderstandingEngineModule } from '../understanding-engine/understanding-engine.module';
import { AutomationsController } from './api/automations.controller';
import { AutomationsService } from './application/automations.service';
import { AutomationSchedulerService } from './application/automation-scheduler.service';
import { RunAutomationUseCase } from './application/run-automation.use-case';
import { SCHEDULER_PORT } from './domain/ports/scheduler.port';
import { CronSchedulerAdapter } from './infrastructure/cron-scheduler.adapter';

/**
 * Automatizaciones — BUSINESSBRAIN_MIGRATION_PLAN.md §5, §10 (fase 6).
 *
 * El reloj del sistema. Hasta aquí el motor de comprensión solo razonaba cuando alguien
 * pulsaba un botón: la Fase 7 construyó la memoria de la creencia sin que casi nada la
 * alimentase, porque una trayectoria necesita ejecuciones repetidas en el tiempo.
 *
 * Este módulo **no importa `AgentsModule`, `LlmModule` ni ningún cliente HTTP**, y no es un
 * descuido. Una automatización solo puede orquestar capacidades internas que ya existen; no
 * teniendo con qué llamar al exterior, "nunca modifica automáticamente" (Principio de
 * Evolución Asistida) queda garantizado por la estructura del código y no por una regla que
 * alguien deba recordar.
 *
 * `SchedulerPort` (§13) se inyecta por símbolo: la elección de temporizador es reversible sin
 * tocar el dominio.
 */
@Module({
  imports: [ScheduleModule.forRoot(), UnderstandingEngineModule],
  controllers: [AutomationsController],
  providers: [
    AutomationsService,
    RunAutomationUseCase,
    AutomationSchedulerService,
    { provide: SCHEDULER_PORT, useClass: CronSchedulerAdapter },
  ],
  exports: [AutomationsService],
})
export class AutomationsModule {}

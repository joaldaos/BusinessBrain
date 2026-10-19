import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { JobDispatcherService } from './application/job-dispatcher.service';
import { JobHandlerRegistry } from './application/job-handler-registry';
import { JOB_QUEUE_PORT } from './domain/ports/job-queue.port';
import { PostgresJobQueue } from './infrastructure/postgres-job-queue';

/**
 * Trabajo diferido — Fase 9A.
 *
 * La pieza que faltaba para que las integraciones sean fiables en producción. Hasta aquí lo
 * único que ocurría solo era el reloj de automatizaciones, que no sobrevive a un reinicio
 * porque no hay nada escrito: si el proceso cae a mitad de una ejecución, esa ejecución se
 * pierde. Para traer datos de un proveedor externo eso no vale — hay que poder reintentar,
 * y hay que saber qué quedó a medias.
 *
 * **No conoce ningún tipo de trabajo concreto.** Los manejadores se declaran donde viven, con
 * el token `JOB_HANDLER`, y este módulo solo los ejecuta. Es lo que permite que un conector
 * nuevo no lo toque.
 *
 * `JOB_QUEUE_PORT` se exporta como símbolo; `PostgresJobQueue` también, porque el despachador
 * necesita las operaciones de reclamación que no forman parte del puerto: encolar es cosa de
 * cualquiera, vaciar la cola es cosa de uno solo.
 */
@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule],
  providers: [
    PostgresJobQueue,
    { provide: JOB_QUEUE_PORT, useExisting: PostgresJobQueue },
    JobHandlerRegistry,
    JobDispatcherService,
  ],
  exports: [JOB_QUEUE_PORT, PostgresJobQueue, JobHandlerRegistry],
})
export class JobsModule {}

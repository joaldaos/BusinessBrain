import { Module, type OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { JobsModule } from '../jobs/jobs.module';
import { BusinessFactsModule } from '../business-facts/business-facts.module';
import { EncryptionService } from '../common/utils/encryption.util';
import { JobHandlerRegistry } from '../jobs/application/job-handler-registry';
import { BusinessConnectorRegistry } from './application/business-connector-registry.service';
import { ConnectorSyncJobHandler } from './application/connector-sync.job-handler';
import { RunConnectorSyncUseCase } from './application/run-connector-sync.use-case';
import { ReceiveWebhookUseCase } from './application/receive-webhook.use-case';
import { WebhooksController } from './api/webhooks.controller';

/**
 * Conectores de hechos — Fase 9A.
 *
 * **No declara ningún conector concreto todavía**, y es deliberado: la arquitectura se cierra
 * antes de escribir el primero. Cuando llegue, se declarará con el token `BUSINESS_CONNECTOR`
 * y no habrá que tocar este módulo ni ningún otro.
 *
 * El manejador de sincronización se da de alta al arrancar, así que `JobsModule` no importa
 * nada de aquí: la cola sabe ejecutar trabajos, no qué trabajos existen.
 */
@Module({
  imports: [PrismaModule, JobsModule, BusinessFactsModule],
  controllers: [WebhooksController],
  providers: [
    EncryptionService,
    BusinessConnectorRegistry,
    RunConnectorSyncUseCase,
    ConnectorSyncJobHandler,
    ReceiveWebhookUseCase,
  ],
  exports: [BusinessConnectorRegistry, RunConnectorSyncUseCase],
})
export class ConnectorsModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobHandlerRegistry,
    private readonly syncHandler: ConnectorSyncJobHandler,
  ) {}

  onModuleInit(): void {
    this.jobs.register(this.syncHandler);
  }
}

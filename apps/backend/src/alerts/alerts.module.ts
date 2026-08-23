import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ALERTS_PORT, type AlertsPort } from './domain/alerts.port';
import {
  LogAlertsAdapter,
  WebhookAlertsAdapter,
} from './infrastructure/alerts.adapters';
import { OperationalAlertsService } from './application/operational-alerts.service';
import { FetchHttpClient } from '../llm/infrastructure/http/fetch-http-client';
import type { AppConfig } from '../config/configuration';

/**
 * El canal de alertas se elige una vez, aquí.
 *
 * `@Global` porque cualquier parte del sistema que pueda fallar de forma desatendida tiene que
 * poder avisar sin que su módulo declare una dependencia de infraestructura.
 *
 * Sin `ALERTS_WEBHOOK_URL` configurada, las alertas van al registro del servidor. Eso no es
 * "no hay alertas": es el mínimo honesto, y sigue siendo infinitamente mejor que el estado
 * anterior, donde un fallo nocturno no dejaba más rastro que una fuente en rojo que nadie
 * miraba.
 */
@Global()
@Module({
  providers: [
    {
      provide: ALERTS_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): AlertsPort => {
        const log = new LogAlertsAdapter();
        const url = config.get('alertsWebhookUrl', { infer: true });

        // El adaptador de webhook escribe TAMBIÉN en el registro: el mensaje externo solo
        // lleva identificadores, y el detalle tiene que quedarse dentro del despliegue.
        return url
          ? new WebhookAlertsAdapter(url, new FetchHttpClient(), log)
          : log;
      },
    },
    OperationalAlertsService,
  ],
  exports: [OperationalAlertsService],
})
export class AlertsModule {}

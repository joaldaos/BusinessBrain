import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAILER, type MailerPort } from './domain/mailer.port';
import {
  FileOutboxMailerAdapter,
  LoggingMailerAdapter,
} from './infrastructure/logging-mailer.adapter';
import type { AppConfig } from '../config/configuration';

/**
 * Qué adaptador de correo se usa.
 *
 * `@Global` porque el correo es infraestructura transversal, como la base de datos: obligar a
 * cada módulo que algún día mande algo a importar este sería ruido sin ninguna garantía a
 * cambio.
 *
 * La elección se hace UNA vez, aquí, mirando el entorno — no repartida en condicionales dentro
 * de los servicios. Un servicio que preguntara "¿estoy en pruebas?" tendría dos comportamientos
 * y solo uno probado.
 */
@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): MailerPort => {
        const isProduction =
          config.get('nodeEnv', { infer: true }) === 'production';
        const outbox = config.get('mailOutboxPath', { infer: true });

        // El buzón en fichero solo existe si alguien lo pide explícitamente, y el propio
        // adaptador se niega a arrancar en producción.
        if (outbox && !isProduction) {
          return new FileOutboxMailerAdapter(outbox, isProduction);
        }
        return new LoggingMailerAdapter(isProduction);
      },
    },
  ],
  exports: [MAILER],
})
export class MailModule {}

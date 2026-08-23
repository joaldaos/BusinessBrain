import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAILER, type MailerPort } from './domain/mailer.port';
import { LoggingMailerAdapter } from './infrastructure/logging-mailer.adapter';
import { SmtpMailerAdapter } from './infrastructure/smtp-mailer.adapter';
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
        const smtpUrl = config.get('smtpUrl', { infer: true });

        // Con servidor de correo configurado, se manda de verdad. `MAIL_FROM` es obligatorio
        // junto a `SMTP_URL` —la validación de entorno lo exige— así que aquí no puede faltar.
        if (smtpUrl) {
          return new SmtpMailerAdapter(
            smtpUrl,
            config.get('mailFrom', { infer: true }) ?? '',
          );
        }

        // Sin configurar: se deja constancia y se avisa. En producción, ruidosamente.
        return new LoggingMailerAdapter(isProduction);
      },
    },
  ],
  exports: [MAILER],
})
export class MailModule {}

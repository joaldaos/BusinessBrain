import { Injectable, Logger } from '@nestjs/common';
import type { MailerPort, OutboundEmail } from '../domain/mailer.port';

/**
 * El adaptador de respaldo: deja constancia de que se mandó un correo, sin mandarlo.
 *
 * Se usa cuando NO hay `SMTP_URL` configurada. En un despliegue de verdad eso es una
 * configuración incompleta, no una elección — de ahí el aviso ruidoso de abajo. En local es lo
 * cómodo: el enlace se lee del registro y no hace falta montar un servidor de correo para
 * probar una pantalla.
 *
 * ## Lo que registra, y lo que jamás registra
 *
 * En producción escribe únicamente **qué clase de correo** salió y **a quién**. El cuerpo no,
 * porque el cuerpo lleva el enlace de recuperación, y un enlace de recuperación en un fichero
 * de log es una contraseña en un fichero de log: cualquiera con acceso a la operación del
 * sistema podría entrar en la cuenta de un cliente. Que sea cómodo para depurar es exactamente
 * lo que lo hace peligroso.
 *
 * Fuera de producción sí escribe el cuerpo entero: en local hace falta poder seguir el enlace,
 * y ahí no hay cuentas de nadie.
 *
 * ## Y una advertencia que se repite a propósito
 *
 * En producción AVISA en cada envío de que el correo no ha salido, en vez de una sola vez al
 * arrancar. Un fallo silencioso aquí significa clientes que piden recuperar su contraseña y no
 * reciben nada, sin que nadie se entere hasta que llaman por teléfono.
 */
@Injectable()
export class LoggingMailerAdapter implements MailerPort {
  private readonly logger = new Logger(LoggingMailerAdapter.name);

  constructor(private readonly isProduction: boolean) {}

  send(email: OutboundEmail): Promise<void> {
    if (this.isProduction) {
      this.logger.warn(
        `Correo "${email.kind}" NO ENVIADO a ${email.to}: falta configurar SMTP_URL.`,
      );
      return Promise.resolve();
    }

    this.logger.log(
      `Correo "${email.kind}" para ${email.to}\n${email.subject}\n${email.body}`,
    );
    return Promise.resolve();
  }
}

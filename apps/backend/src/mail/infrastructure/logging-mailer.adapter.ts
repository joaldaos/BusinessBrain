import { Injectable, Logger } from '@nestjs/common';
import { appendFile } from 'node:fs/promises';
import type { MailerPort, OutboundEmail } from '../domain/mailer.port';

/**
 * El adaptador por defecto: deja constancia de que se mandó un correo, sin mandarlo.
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
 * Mientras no haya un proveedor real conectado, este adaptador AVISA en cada envío de
 * producción de que el correo no ha salido. Un fallo silencioso aquí significa clientes que
 * piden recuperar su contraseña y no reciben nada, sin que nadie se entere hasta que llaman.
 */
@Injectable()
export class LoggingMailerAdapter implements MailerPort {
  private readonly logger = new Logger(LoggingMailerAdapter.name);

  constructor(private readonly isProduction: boolean) {}

  send(email: OutboundEmail): Promise<void> {
    if (this.isProduction) {
      this.logger.warn(
        `Correo "${email.kind}" NO ENVIADO a ${email.to}: no hay proveedor de correo configurado.`,
      );
      return Promise.resolve();
    }

    this.logger.log(
      `Correo "${email.kind}" para ${email.to}\n${email.subject}\n${email.body}`,
    );
    return Promise.resolve();
  }
}

/**
 * Adaptador de pruebas: escribe cada correo en un fichero.
 *
 * Existe para que la suite de navegador pueda recorrer la recuperación de contraseña ENTERA,
 * de verdad, sin que el testigo viaje nunca en una respuesta HTTP. La alternativa —devolverlo
 * en el cuerpo "solo en pruebas"— sería abrir en el código de producción justo la puerta que
 * todo este flujo existe para cerrar.
 *
 * Se niega a funcionar en producción. No por prudencia: porque el fichero contendría enlaces
 * de recuperación de clientes reales en texto plano.
 */
@Injectable()
export class FileOutboxMailerAdapter implements MailerPort {
  constructor(
    private readonly path: string,
    isProduction: boolean,
  ) {
    if (isProduction) {
      throw new Error(
        'FileOutboxMailerAdapter no puede usarse en producción: escribiría enlaces de recuperación en texto plano.',
      );
    }
  }

  async send(email: OutboundEmail): Promise<void> {
    await appendFile(this.path, `${JSON.stringify(email)}\n`, 'utf8');
  }
}

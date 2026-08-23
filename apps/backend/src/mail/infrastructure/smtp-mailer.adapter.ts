import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { MailerPort, OutboundEmail } from '../domain/mailer.port';

/**
 * El adaptador que manda correo de verdad, por SMTP.
 *
 * ## Por qué SMTP y no el SDK de un proveedor
 *
 * SMTP lo habla todo el mundo: el correo corporativo que la PYME ya tiene, un servicio
 * transaccional, o el propio hosting. Atarse al SDK de un proveedor concreto para mandar una
 * frase al día significaría que cambiar de proveedor es un cambio de código y un despliegue,
 * en lugar de cambiar una variable.
 *
 * ## La credencial vive en el entorno y no sale de aquí
 *
 * Llega como una URL de conexión completa (`smtps://usuario:clave@servidor:465`) porque es lo
 * que documentan casi todos los proveedores y porque así es UN secreto que gestionar, no
 * cuatro variables que hay que acertar a la vez.
 *
 * Y no aparece en ningún sitio más: `nodemailer` trae su propio registro de actividad —que
 * escribe la conversación SMTP entera, credenciales incluidas— y aquí está **apagado a
 * propósito**. Lo que este adaptador escribe en el registro es a quién se mandó y de qué clase
 * era; nunca el cuerpo, que lleva el enlace de recuperación, y nunca la conexión.
 *
 * ## Un fallo de envío no revela nada
 *
 * El error de SMTP puede incluir la URL de conexión con la clave dentro. Se recorta antes de
 * que llegue a ningún registro: quien opera necesita saber que el correo no salió, no la
 * contraseña del buzón.
 */
@Injectable()
export class SmtpMailerAdapter implements MailerPort {
  private readonly logger = new Logger(SmtpMailerAdapter.name);
  private readonly transporter: Transporter;

  constructor(
    connectionUrl: string,
    private readonly from: string,
  ) {
    this.transporter = createTransport(connectionUrl, {
      // Sin registro de actividad: `nodemailer` volcaría la conversación SMTP entera,
      // credenciales y cuerpo del mensaje incluidos.
      logger: false,
      debug: false,
    });
  }

  async send(email: OutboundEmail): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email.to,
        subject: email.subject,
        text: email.body,
      });

      // QUÉ se mandó y A QUIÉN. El cuerpo no: lleva el enlace de recuperación, y un enlace de
      // recuperación en un fichero de log es una contraseña en un fichero de log.
      this.logger.log(`Correo "${email.kind}" enviado a ${email.to}`);
    } catch (error) {
      // Se relanza —quien llama decide qué hacer— pero con el mensaje ya limpio.
      throw new Error(
        `No se pudo enviar el correo "${email.kind}": ${redactCredentials(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
    }
  }
}

/**
 * `smtps://ana:secreto@correo.com:465` → `smtps://***@correo.com:465`.
 *
 * Los errores de SMTP citan la URL de conexión con la clave dentro. Este es el único sitio
 * que la tiene en la mano, así que es el único que puede quitarla antes de que viaje a un
 * registro o a un canal de alertas.
 */
export function redactCredentials(message: string): string {
  return message.replace(/\/\/[^/@\s]+:[^/@\s]+@/g, '//***@');
}

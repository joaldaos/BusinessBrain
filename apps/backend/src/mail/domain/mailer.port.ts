/**
 * Por dónde sale un correo de BusinessBrain.
 *
 * ## Por qué un puerto para mandar una sola cosa
 *
 * Hoy el producto manda exactamente un mensaje: el enlace para recuperar la contraseña. Montar
 * alrededor de eso un sistema de correo con plantillas, colas, reintentos y seguimiento de
 * aperturas sería construir la parte cara antes de saber qué hace falta.
 *
 * Lo que sí hacía falta desde el principio es que el resto del código **no sepa** cómo se
 * manda. Se nota ahora: conectar SMTP fue escribir un adaptador, sin tocar ni una línea del
 * flujo de recuperación. Sin el puerto habría habido que ir a buscar las llamadas repartidas
 * por los servicios.
 *
 * Hay dos adaptadores: `SmtpMailerAdapter`, que manda de verdad, y `LoggingMailerAdapter`, que
 * deja constancia cuando no hay servidor configurado. Cuál se usa lo decide el entorno, una
 * sola vez, en `mail.module.ts`.
 *
 * ## Qué NO es responsabilidad de un adaptador
 *
 * Decidir el contenido. El cuerpo del mensaje se compone en el dominio, donde se puede leer y
 * comprobar, y llega aquí ya hecho. Un adaptador que redactara texto sería un sitio donde
 * esconder un enlace mal formado sin que ninguna prueba lo viera.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  /** Texto plano. Sin HTML todavía: nada de lo que se manda hoy lo necesita. */
  body: string;
  /**
   * Qué es este correo. No viaja al destinatario: sirve para poder registrar que se mandó algo
   * sin registrar QUÉ se mandó, que es justo lo que hay que evitar con un enlace de
   * recuperación.
   */
  kind: 'password-reset';
}

export interface MailerPort {
  send(email: OutboundEmail): Promise<void>;
}

/** Token de inyección. */
export const MAILER = Symbol('MailerPort');

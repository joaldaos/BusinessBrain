/**
 * Por dónde sale un correo de BusinessBrain.
 *
 * ## Por qué solo hay un puerto y ningún proveedor
 *
 * Hoy el producto necesita mandar exactamente una cosa: el enlace para recuperar la contraseña.
 * Montar alrededor de eso un sistema de correo con plantillas, colas, reintentos y seguimiento
 * de aperturas sería construir la parte cara antes de saber qué hace falta.
 *
 * Lo que sí hace falta ya es que el resto del código **no sepa** cómo se manda. Con el puerto
 * puesto, conectar un proveedor real es escribir un adaptador y cambiar una línea del módulo;
 * sin él, habría que ir a buscar las llamadas repartidas por los servicios.
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

import { createHmac, randomBytes } from 'node:crypto';
import type { OutboundEmail } from '../../mail/domain/mailer.port';

/**
 * Recuperar la contraseña sin que nadie toque la base de datos.
 *
 * ## El testigo es una contraseña temporal, y se trata como tal
 *
 * Quien tenga el enlace entra en la cuenta. No hay segundo factor ni pregunta de seguridad
 * detrás, así que el enlace vale exactamente lo mismo que la contraseña que sustituye. De ahí
 * las tres reglas que no son negociables:
 *
 * 1. **Aleatorio de verdad** — 32 bytes del generador criptográfico. Un identificador
 *    secuencial o un `Math.random()` se adivinan.
 * 2. **Nunca se guarda tal cual** — en la tabla vive su HMAC. Quien leyera la tabla no podría
 *    componer ningún enlace sin conocer además el secreto de la aplicación. HMAC y no un
 *    `sha256` pelado por eso mismo: con un hash simple bastaría con recalcularlo.
 * 3. **Vida corta y un solo uso** — una hora. El correo de una PYME acaba reenviado, impreso o
 *    en un buzón compartido; un enlace que sigue valiendo dentro de un mes es una llave suelta.
 *
 * ## Por qué una hora y no quince minutos
 *
 * Quince minutos suena más seguro y en la práctica no lo es: la gente pide la recuperación,
 * atiende el teléfono y vuelve. Un enlace caducado obliga a repetir el ciclo entero y empuja a
 * pedir tres seguidos, que es peor. Una hora cabe en una interrupción normal.
 */

const RESET_TOKEN_BYTES = 32;

/** Cuánto vale el enlace. Ver arriba por qué una hora. */
export const PASSWORD_RESET_LIFETIME_MS = 60 * 60 * 1000;

export function generateResetToken(): string {
  return randomBytes(RESET_TOKEN_BYTES).toString('hex');
}

/**
 * El testigo, tal y como se guarda.
 *
 * Mismo trato que los tokens de refresco y con el mismo secreto: si algún día se rota, se
 * invalidan a la vez todas las sesiones y todas las recuperaciones pendientes, que es
 * exactamente lo que se querría al rotarlo.
 */
export function hashResetToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

/**
 * El enlace que recibe la persona.
 *
 * El testigo va en la consulta y no en el camino por una razón práctica: la interfaz lo lee con
 * `useSearchParams` y no necesita una ruta con parámetro. Va en una URL que llega por correo,
 * así que acabará en el historial del navegador — es otra de las razones por las que caduca y
 * se usa una sola vez.
 */
export function resetLinkFor(frontendUrl: string, token: string): string {
  const url = new URL('/restablecer', frontendUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

/**
 * El correo.
 *
 * Se compone aquí, en el dominio, y no dentro de un adaptador: así se puede leer y comprobar.
 * El tono es el de alguien que escribe a una persona que probablemente esté agobiada porque no
 * puede entrar en su herramienta de trabajo, no el de una notificación de sistema.
 *
 * Dice explícitamente qué hacer si NO fue quien lo pidió. Es la única señal que va a recibir
 * alguien cuya cuenta están intentando tomar, y esconderla en la letra pequeña sería
 * desaprovecharla.
 */
export function passwordResetEmail(params: {
  to: string;
  name: string;
  link: string;
}): OutboundEmail {
  const horas = PASSWORD_RESET_LIFETIME_MS / (60 * 60 * 1000);

  return {
    to: params.to,
    kind: 'password-reset',
    subject: 'Recupera tu acceso a BusinessBrain',
    body: [
      `Hola ${params.name}:`,
      '',
      'Has pedido volver a entrar en BusinessBrain. Abre este enlace y elige una contraseña nueva:',
      '',
      params.link,
      '',
      `El enlace caduca en ${horas === 1 ? 'una hora' : `${horas} horas`} y solo se puede usar una vez.`,
      '',
      'Si no has sido tú, no hace falta que hagas nada: tu contraseña actual sigue funcionando y este enlace caducará solo. Si te llegan varios correos como este seguidos, avísanos.',
      '',
      'BusinessBrain',
    ].join('\n'),
  };
}

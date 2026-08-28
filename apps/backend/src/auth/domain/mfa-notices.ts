import type { OutboundEmail } from '../../mail/domain/mailer.port';

/**
 * Los avisos de que alguien ha retirado un segundo factor.
 *
 * ## Por qué se avisa siempre, y a dos personas
 *
 * Retirar el segundo factor de una cuenta es lo más cerca que alguien de fuera llega de esa
 * cuenta. No da acceso —después sigue haciendo falta la contraseña— pero la deja con una sola
 * prueba en lugar de dos. Que ocurra sin que la persona se entere sería exactamente el
 * escenario que hay que evitar: si la retirada no fue legítima, este correo es la única señal
 * que va a recibir.
 *
 * Se avisa también al propietario de su empresa porque es quien responde por ella. Un
 * administrador al que le retiran el segundo factor sin que su propietario lo sepa es un
 * agujero en la cadena de decisión de esa empresa, no un detalle operativo nuestro.
 *
 * ## Lo que NO llevan estos correos
 *
 * Ningún enlace sobre el que actuar. No hay nada que confirmar ni ninguna sesión que abrir
 * desde aquí: un correo de seguridad con un botón es un correo de seguridad que se puede
 * falsificar para conseguir que alguien lo pulse. Este solo informa y dice a quién escribir.
 */

export function mfaRemovedByPlatformEmail(params: {
  to: string;
  name: string;
  reason: string;
}): OutboundEmail {
  return {
    to: params.to,
    kind: 'mfa-removed',
    subject: 'Se ha retirado la verificación en dos pasos de tu cuenta',
    body: [
      `Hola ${params.name}:`,
      '',
      'El equipo de BusinessBrain ha retirado la verificación en dos pasos de tu cuenta. Motivo indicado:',
      '',
      params.reason,
      '',
      'Qué significa esto: para entrar ya no se te pedirá el código de tu aplicación. Tu contraseña NO ha cambiado y sigue haciendo falta para entrar.',
      '',
      'Te recomendamos volver a activar la verificación en dos pasos desde tu configuración en cuanto puedas.',
      '',
      'Si no habías pedido esto, escríbenos ahora mismo.',
      '',
      'BusinessBrain',
    ].join('\n'),
  };
}

export function mfaRemovedByPlatformOwnerNoticeEmail(params: {
  to: string;
  ownerName: string;
  affectedName: string;
  organizationName: string;
  reason: string;
}): OutboundEmail {
  return {
    to: params.to,
    kind: 'mfa-removed',
    subject: `Cambio de seguridad en una cuenta de ${params.organizationName}`,
    body: [
      `Hola ${params.ownerName}:`,
      '',
      `El equipo de BusinessBrain ha retirado la verificación en dos pasos de la cuenta de ${params.affectedName}, de tu empresa. Motivo indicado:`,
      '',
      params.reason,
      '',
      'Te avisamos porque eres quien responde por esta empresa. No se ha cambiado ninguna contraseña ni se ha accedido a ningún documento: retirar la verificación en dos pasos solo afecta a cómo entra esa persona en su propia cuenta.',
      '',
      'Si esto no te cuadra, escríbenos.',
      '',
      'BusinessBrain',
    ].join('\n'),
  };
}

export function mfaRemovedByOwnerEmail(params: {
  to: string;
  name: string;
  ownerName: string;
  organizationName: string;
}): OutboundEmail {
  return {
    to: params.to,
    kind: 'mfa-removed',
    subject: 'Se ha retirado la verificación en dos pasos de tu cuenta',
    body: [
      `Hola ${params.name}:`,
      '',
      `${params.ownerName}, propietario de ${params.organizationName}, ha retirado la verificación en dos pasos de tu cuenta.`,
      '',
      'Tu contraseña no ha cambiado. Para entrar ya no se te pedirá el código de tu aplicación, así que te recomendamos volver a activarla desde tu configuración.',
      '',
      'Si no esperabas este cambio, háblalo con esa persona.',
      '',
      'BusinessBrain',
    ].join('\n'),
  };
}

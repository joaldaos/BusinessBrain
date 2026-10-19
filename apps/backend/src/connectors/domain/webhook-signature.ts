import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificación de un envío entrante.
 *
 * ## Por qué un endpoint público necesita esto
 *
 * La URL de un webhook acaba siendo conocida: aparece en la configuración del proveedor, en
 * capturas, en registros. Sin firma, cualquiera que la tenga puede inyectar ventas que no
 * ocurrieron, y BusinessBrain las analizaría como ciertas — con conclusiones y
 * recomendaciones encima. Aquí un dato falso no es ruido: es una decisión empresarial
 * equivocada con apariencia de estar respaldada.
 *
 * ## Las tres cosas que se comprueban
 *
 * 1. **Que lo firmó quien dice.** HMAC-SHA256 sobre el cuerpo EXACTO recibido.
 * 2. **Que no es un reenvío.** Una marca de tiempo dentro de una ventana estrecha. Sin esto,
 *    una petición legítima capturada una vez sirve para siempre.
 * 3. **Que se compara sin filtrar el secreto.** Comparación en tiempo constante: un `===`
 *    normal tarda más cuantos más caracteres coincidan, y eso basta para adivinar una firma
 *    byte a byte.
 */

/** Cuánto puede desviarse el reloj del proveedor antes de rechazar el envío. */
export const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export type WebhookRejection =
  | 'SIN_FIRMA'
  | 'SIN_MARCA_DE_TIEMPO'
  | 'MARCA_DE_TIEMPO_INVALIDA'
  | 'FUERA_DE_VENTANA'
  | 'FIRMA_NO_COINCIDE';

export interface VerificationResult {
  ok: boolean;
  reason?: WebhookRejection;
}

export interface VerifyParams {
  /** El cuerpo TAL COMO LLEGÓ. Firmar sobre el JSON reserializado no verifica nada. */
  rawBody: Buffer | string;
  signature: string | undefined;
  /** Milisegundos desde época, como lo manda el proveedor. */
  timestamp: string | undefined;
  secret: string;
  now?: Date;
  windowMs?: number;
}

/**
 * Lo que se firma.
 *
 * El instante va DENTRO de lo firmado, y es lo que hace que la protección contra reenvíos
 * sea real: si quedara fuera, bastaría con cambiarlo para que una petición capturada volviera
 * a entrar en ventana, conservando su firma válida.
 */
export function signedPayload(
  timestamp: string,
  rawBody: Buffer | string,
): string {
  const cuerpo = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  return `${timestamp}.${cuerpo}`;
}

/** La firma que debería traer un envío. Se usa al verificar y al simular un proveedor. */
export function computeSignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer | string,
): string {
  return createHmac('sha256', secret)
    .update(signedPayload(timestamp, rawBody))
    .digest('hex');
}

export function verifyWebhook(params: VerifyParams): VerificationResult {
  const { signature, timestamp, secret, rawBody } = params;
  const ahora = (params.now ?? new Date()).getTime();
  const ventana = params.windowMs ?? REPLAY_WINDOW_MS;

  if (!signature) return { ok: false, reason: 'SIN_FIRMA' };
  if (!timestamp) return { ok: false, reason: 'SIN_MARCA_DE_TIEMPO' };

  const enviado = Number(timestamp);
  if (!Number.isFinite(enviado)) {
    return { ok: false, reason: 'MARCA_DE_TIEMPO_INVALIDA' };
  }

  /*
   * La ventana se mira en los DOS sentidos.
   *
   * Hacia atrás impide reenviar algo antiguo. Hacia delante impide que un reloj adelantado
   * —por error o a propósito— deje una petición válida durante horas.
   */
  if (Math.abs(ahora - enviado) > ventana) {
    return { ok: false, reason: 'FUERA_DE_VENTANA' };
  }

  const esperada = computeSignature(secret, timestamp, rawBody);
  return igualEnTiempoConstante(signature, esperada)
    ? { ok: true }
    : { ok: false, reason: 'FIRMA_NO_COINCIDE' };
}

/**
 * Comparación que no delata cuánto se ha acertado.
 *
 * `timingSafeEqual` exige longitudes iguales y lanza si no lo son — y la longitud en sí no es
 * secreta, así que compararla antes no filtra nada.
 */
function igualEnTiempoConstante(recibida: string, esperada: string): boolean {
  const a = Buffer.from(recibida, 'utf8');
  const b = Buffer.from(esperada, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Qué se le cuenta al proveedor cuando se rechaza su envío.
 *
 * **Siempre lo mismo.** Distinguir «firma incorrecta» de «fuera de ventana» le diría a quien
 * esté probando qué parte ya tiene bien, y eso convierte un rechazo en una pista. El motivo
 * concreto queda en el registro interno, que es donde hace falta para diagnosticar.
 */
export const RESPUESTA_AL_RECHAZAR = 'Envío no verificado';

/**
 * Avisos de que algo se ha roto por dentro.
 *
 * ## El problema que resuelven
 *
 * Si la sincronización nocturna de una PYME revienta, hoy nadie se entera. El cliente lo
 * descubre days después preguntando algo y no obteniendo respuesta, y para entonces lleva una
 * semana tomando decisiones con conocimiento viejo. Con cinco pilotos, la diferencia entre
 * enterarse tú y enterarse él es la diferencia entre una incidencia y una baja.
 *
 * ## Qué NO son
 *
 * No son notificaciones para el cliente. Van a un canal de quien opera BusinessBrain: es un
 * aviso de que hay que ir a mirar, no un mensaje al usuario. Avisar al cliente de que su
 * sincronización falló, sin poder decirle todavía qué hacer al respecto, sería trasladarle un
 * problema que no puede resolver.
 */

export type AlertKind =
  'sync-failed' | 'analysis-failed' | 'source-failing-repeatedly';

export interface OperationalAlert {
  kind: AlertKind;
  organizationId: string;
  /** Qué entidad falló: la fuente o la ejecución de análisis. */
  targetId: string;
  /**
   * El error real.
   *
   * Se guarda aparte del resto a propósito: un mensaje de error puede llevar dentro el
   * título de un documento del cliente, y eso NO puede salir hacia un canal externo. Ver
   * `webhook-alerts.adapter.ts`.
   */
  detail: string;
  /** Cuántas veces seguidas ha fallado. `1` es la primera. */
  consecutiveFailures?: number;
}

/** Cuántos fallos seguidos convierten "una noche mala" en "esta fuente está rota". */
export const REPEATED_FAILURE_THRESHOLD = 3;

const TITULOS: Record<AlertKind, string> = {
  'sync-failed': 'Falló una sincronización',
  'analysis-failed': 'Falló un análisis',
  'source-failing-repeatedly': 'Una fuente lleva varios fallos seguidos',
};

/**
 * El texto que sale hacia un canal EXTERNO.
 *
 * Lleva identificadores y nada más. Sin nombres de empresa, sin nombres de fuente y sin el
 * mensaje de error, porque cualquiera de los tres puede contener información del cliente —el
 * error de ingesta cita el título del documento que falló— y un canal de chat es un tercero
 * más, con su propio almacenamiento y su propia gente dentro.
 *
 * Quien recibe esto tiene acceso al sistema: con el identificador va y mira. Lo que se pierde
 * es comodidad; lo que se gana es que los documentos de una PYME no acaben en un chat.
 */
export function externalAlertText(alert: OperationalAlert): string {
  const veces =
    alert.consecutiveFailures && alert.consecutiveFailures > 1
      ? ` (${alert.consecutiveFailures} veces seguidas)`
      : '';

  return `BusinessBrain — ${TITULOS[alert.kind]}${veces}. Organización ${alert.organizationId}, elemento ${alert.targetId}. Revisa el registro del servidor para ver el detalle.`;
}

/** El texto para el registro interno, que sí se queda dentro del despliegue. */
export function internalAlertText(alert: OperationalAlert): string {
  const veces =
    alert.consecutiveFailures && alert.consecutiveFailures > 1
      ? ` [${alert.consecutiveFailures} fallos seguidos]`
      : '';

  return `${TITULOS[alert.kind]}${veces} — organización=${alert.organizationId} elemento=${alert.targetId}: ${alert.detail}`;
}

import type { OperationalAlert } from './operational-alert';

/**
 * Por dónde sale un aviso operativo.
 *
 * Un solo método, a propósito. Lo que hace falta para el piloto es "avísame de que algo se ha
 * roto"; niveles de severidad, agrupación, silenciado y turnos de guardia son un sistema de
 * alertas, y construirlo antes de saber qué se rompe de verdad sería construir la parte cara
 * sin datos.
 */
export interface AlertsPort {
  raise(alert: OperationalAlert): Promise<void>;
}

/** Token de inyección. */
export const ALERTS_PORT = Symbol('AlertsPort');

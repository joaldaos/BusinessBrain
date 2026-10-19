/**
 * Cuándo volver a intentar un trabajo que ha fallado.
 *
 * ## Por qué crece
 *
 * Un fallo rara vez es instantáneamente recuperable: el proveedor está caído, el token
 * caducó, la red va mal. Reintentar de inmediato convierte una avería ajena en una tormenta
 * propia —miles de llamadas por minuto contra un servicio que ya está mal— y además llena el
 * tic de trabajo que va a volver a fallar, dejando sin turno a los trabajos sanos.
 *
 * ## Por qué lleva ruido
 *
 * Sin él, cien trabajos que fallan por la misma caída vuelven todos a la vez, exactamente al
 * mismo segundo, y repiten el pico cada vez. El ruido los dispersa.
 *
 * Es una función pura y el azar entra por parámetro: una espera que no se puede comprobar es
 * una espera en la que no se puede confiar.
 */

/** Primer reintento. Lo bastante corto para un tropiezo, lo bastante largo para no insistir. */
const BASE_DELAY_MS = 10_000;

/**
 * Tope. A partir de aquí no tiene sentido seguir separando: si algo lleva una hora roto,
 * lo que falta es que alguien lo mire, no esperar más.
 */
const MAX_DELAY_MS = 60 * 60 * 1000;

/** Cuánto puede desviarse del valor teórico, en tanto por uno. */
const JITTER_RATIO = 0.25;

export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  /** Fuente de azar. Inyectable para poder comprobar el resultado. */
  random?: () => number;
}

/**
 * Espera antes del siguiente intento.
 *
 * @param attempts intentos YA consumidos (1 tras el primer fallo).
 * @returns milisegundos a esperar, nunca negativos.
 */
export function backoffDelayMs(
  attempts: number,
  options: BackoffOptions = {},
): number {
  const base = options.baseDelayMs ?? BASE_DELAY_MS;
  const max = options.maxDelayMs ?? MAX_DELAY_MS;
  const jitterRatio = options.jitterRatio ?? JITTER_RATIO;
  const random = options.random ?? Math.random;

  // Un `attempts` incoherente no debe producir una espera negativa ni instantánea: se
  // trata como el primer fallo. Vale más reintentar tarde que convertir un dato corrupto
  // en un bucle cerrado.
  const consumed = Number.isFinite(attempts) && attempts > 0 ? attempts : 1;

  // 2^(n-1), acotado ANTES de multiplicar: con 1.100 intentos, `2 ** 1099` es Infinity y
  // `Infinity * base` seguiría siendo Infinity, que no es una fecha.
  const factor = Math.min(2 ** Math.min(consumed - 1, 32), max / base);
  const teorico = Math.min(base * factor, max);

  // El ruido solo resta, nunca suma: así el tope sigue siendo un tope de verdad.
  const jitter = teorico * jitterRatio * random();
  return Math.max(0, Math.round(teorico - jitter));
}

/** Instante del siguiente intento. */
export function nextAttemptAt(
  attempts: number,
  from: Date,
  options: BackoffOptions = {},
): Date {
  return new Date(from.getTime() + backoffDelayMs(attempts, options));
}

/**
 * ¿Se han agotado los intentos?
 *
 * Fuera de la cola y en el dominio porque es la regla que decide que un trabajo pase a
 * DEAD, y esa decisión debe poder comprobarse sin base de datos delante.
 */
export function hasExhaustedAttempts(
  attempts: number,
  maxAttempts: number,
): boolean {
  return attempts >= maxAttempts;
}

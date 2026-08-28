/**
 * Cuántas veces seguidas puede alguien llamar a las puertas que más duelen.
 *
 * ## Qué protege cada límite
 *
 * No son el mismo problema y por eso no llevan el mismo número:
 *
 * - **Entrar** — probar contraseñas. Diez intentos en cinco minutos deja escribir mal la
 *   contraseña varias veces seguidas, que es lo normal, y hace inviable recorrer un
 *   diccionario.
 * - **Crear cuenta** — llenar la base de datos de cuentas basura desde un script.
 * - **Recuperar la contraseña** — dos cosas a la vez: inundar el buzón de una persona con
 *   correos que no ha pedido, y medir el tiempo de respuesta para averiguar qué direcciones
 *   existen. Esa medición necesita cientos de intentos; con cinco a la hora, no hay medición.
 * - **Preguntar** — cada pregunta cuesta dinero en la cuenta del cliente. El límite es
 *   generoso a propósito: aquí el peligro no es el atacante sino el bucle accidental.
 *
 * ## Por qué se cuenta por dirección IP y qué significa eso
 *
 * Es lo único que hay antes de iniciar sesión, que es justo donde están los ataques que esto
 * frena. La consecuencia es que **una oficina entera comparte límite**: diez personas de la
 * misma PYME salen por la misma IP. Por eso los números tienen holgura y por eso existe el
 * multiplicador de abajo.
 *
 * ## El multiplicador
 *
 * Un solo mando, y a propósito. La pregunta real de quien opera esto nunca es "¿cuántos
 * registros por hora?", es "esto le va justo a un cliente grande": `RATE_LIMIT_MULTIPLIER=5` y
 * se acabó. Ocho variables de entorno para afinar cada límite serían ocho cosas que nadie va a
 * afinar y que se quedarían desincronizadas del código.
 *
 * En pruebas se sube mucho para que las suites sean deterministas: el mecanismo sigue montado
 * y enchufado —eso es lo que hay que verificar— pero los números no interfieren. Los límites
 * de verdad se comprueban en una suite dedicada que los baja a propósito.
 */

export interface RateLimitPolicy {
  /** Ventana en milisegundos. */
  ttl: number;
  /** Peticiones permitidas dentro de la ventana. */
  limit: number;
}

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

export const RATE_LIMITS = {
  /** Entrar: contraseñas mal escritas sí, diccionario no. */
  login: { ttl: 5 * MINUTO, limit: 10 },
  /** Crear cuenta. */
  register: { ttl: HORA, limit: 5 },
  /** Pedir el enlace de recuperación. */
  passwordResetRequest: { ttl: HORA, limit: 5 },
  /** Usar el enlace. Más holgado: escribir mal la contraseña nueva es normal. */
  passwordResetConfirm: { ttl: HORA, limit: 20 },
  /** Preguntar. Generoso: protege del bucle accidental, no de una persona. */
  ask: { ttl: MINUTO, limit: 30 },
  /**
   * Códigos de verificación en dos pasos.
   *
   * Este límite NO es la defensa principal, y decirlo importa: contar por dirección IP no ve
   * un ataque repartido entre mil direcciones, que es exactamente como se ataca un número de
   * seis dígitos. Quien defiende de verdad es el contador POR CUENTA de `mfa-policy.ts`.
   *
   * Este otro cubre lo que aquel no puede: un script que prueba códigos contra muchas cuentas
   * distintas desde el mismo sitio, donde cada cuenta ve un solo intento y ninguna se bloquea.
   */
  mfa: { ttl: 5 * MINUTO, limit: 20 },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Los límites ya escalados por el multiplicador del entorno.
 *
 * Un multiplicador inválido o menor que uno se ignora: alguien que escriba `0` por error
 * dejaría el producto inutilizable, y ese no puede ser el resultado de una errata en una
 * variable de entorno.
 */
export function rateLimitsFor(
  multiplier: number,
): Record<string, RateLimitPolicy> {
  const factor =
    Number.isFinite(multiplier) && multiplier >= 1 ? multiplier : 1;

  return Object.fromEntries(
    Object.entries(RATE_LIMITS).map(([name, policy]) => [
      name,
      { ttl: policy.ttl, limit: Math.ceil(policy.limit * factor) },
    ]),
  );
}

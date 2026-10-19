import {
  backoffDelayMs,
  hasExhaustedAttempts,
  nextAttemptAt,
} from './job-backoff';

/**
 * La espera entre reintentos.
 *
 * Importa más de lo que parece: es lo que impide que la caída de un proveedor se convierta
 * en una tormenta de peticiones nuestras, y lo que evita que cien trabajos que fallaron a
 * la vez vuelvan todos a la vez para siempre.
 */
describe('backoffDelayMs', () => {
  /** Sin ruido, la espera teórica es comprobable exactamente. */
  const sinRuido = { random: () => 0 };

  it('crece de forma exponencial con cada intento', () => {
    expect(backoffDelayMs(1, sinRuido)).toBe(10_000);
    expect(backoffDelayMs(2, sinRuido)).toBe(20_000);
    expect(backoffDelayMs(3, sinRuido)).toBe(40_000);
    expect(backoffDelayMs(4, sinRuido)).toBe(80_000);
  });

  it('nunca supera el tope, por muchos intentos que se acumulen', () => {
    for (const intentos of [10, 50, 1_000]) {
      expect(backoffDelayMs(intentos, sinRuido)).toBeLessThanOrEqual(
        60 * 60 * 1000,
      );
    }
  });

  /**
   * `2 ** 1099` es Infinity, y una espera infinita produce una fecha inválida que la base
   * rechaza — dejando el trabajo en RUNNING para siempre.
   */
  it('sigue dando un número con un recuento de intentos absurdo', () => {
    const espera = backoffDelayMs(1_100, sinRuido);
    expect(Number.isFinite(espera)).toBe(true);
    expect(espera).toBe(60 * 60 * 1000);
  });

  it('el ruido dispersa, pero solo hacia abajo: el tope sigue siendo un tope', () => {
    const teorico = 40_000;
    for (const azar of [0, 0.5, 0.999]) {
      const espera = backoffDelayMs(3, { random: () => azar });
      expect(espera).toBeLessThanOrEqual(teorico);
      expect(espera).toBeGreaterThanOrEqual(teorico * 0.75);
    }
  });

  it.each([0, -3, NaN])(
    'con un recuento imposible (%s) espera, en vez de reintentar al instante',
    (intentos) => {
      expect(backoffDelayMs(intentos, sinRuido)).toBe(10_000);
    },
  );

  it('nunca devuelve una espera negativa', () => {
    for (let intentos = 1; intentos <= 20; intentos++) {
      expect(
        backoffDelayMs(intentos, { random: () => 1 }),
      ).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('nextAttemptAt', () => {
  it('sitúa el siguiente intento por delante del instante de referencia', () => {
    const ahora = new Date('2026-10-19T10:00:00.000Z');
    const siguiente = nextAttemptAt(1, ahora, { random: () => 0 });

    expect(siguiente.getTime()).toBe(ahora.getTime() + 10_000);
    expect(Number.isNaN(siguiente.getTime())).toBe(false);
  });
});

describe('hasExhaustedAttempts', () => {
  it('da por agotado al alcanzar el máximo, no al superarlo', () => {
    expect(hasExhaustedAttempts(4, 5)).toBe(false);
    expect(hasExhaustedAttempts(5, 5)).toBe(true);
    expect(hasExhaustedAttempts(6, 5)).toBe(true);
  });
});

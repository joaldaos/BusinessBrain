import { RATE_LIMITS, rateLimitsFor } from './rate-limits';

describe('límites de peticiones', () => {
  it('el multiplicador ensancha todos los límites', () => {
    const holgados = rateLimitsFor(5);

    expect(holgados.login.limit).toBe(RATE_LIMITS.login.limit * 5);
    expect(holgados.register.limit).toBe(RATE_LIMITS.register.limit * 5);
  });

  it('la ventana NO cambia con el multiplicador', () => {
    // Ensanchar la ventana sería otra cosa: permitiría el mismo número de intentos repartidos
    // en más tiempo, que es justo lo que un ataque lento necesita.
    expect(rateLimitsFor(10).login.ttl).toBe(RATE_LIMITS.login.ttl);
  });

  it('CRÍTICO: un multiplicador absurdo no deja el producto sin límites ni inutilizable', () => {
    // `0` por error dejaría a cero peticiones permitidas: nadie podría entrar. Una errata en
    // una variable de entorno no puede tener ese resultado.
    for (const invalido of [0, -3, Number.NaN, 0.5]) {
      expect(rateLimitsFor(invalido).login.limit).toBe(RATE_LIMITS.login.limit);
    }
  });

  it('entrar permite equivocarse varias veces pero no recorrer un diccionario', () => {
    expect(RATE_LIMITS.login.limit).toBeGreaterThanOrEqual(5);
    expect(RATE_LIMITS.login.limit).toBeLessThanOrEqual(20);
  });

  it('pedir la recuperación es el más estrecho', () => {
    // Es el que protege de dos cosas a la vez: inundar el buzón de alguien, y medir tiempos
    // de respuesta para averiguar qué direcciones existen.
    expect(RATE_LIMITS.passwordResetRequest.limit).toBeLessThanOrEqual(
      RATE_LIMITS.login.limit,
    );
  });

  it('preguntar es el más holgado: protege del bucle, no de la persona', () => {
    expect(RATE_LIMITS.ask.limit).toBeGreaterThan(RATE_LIMITS.login.limit);
  });
});

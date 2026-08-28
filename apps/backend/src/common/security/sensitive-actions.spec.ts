import {
  REAUTH_WINDOW_MS,
  SENSITIVE_ACTIONS,
  isRecentlyAuthenticated,
  reauthenticatedUntil,
} from './sensitive-actions';

describe('la ventana de "recién autenticado"', () => {
  const AHORA = new Date('2026-08-27T10:00:00.000Z');
  const haceMinutos = (minutos: number) =>
    new Date(AHORA.getTime() - minutos * 60_000);

  it('dura quince minutos', () => {
    expect(REAUTH_WINDOW_MS).toBe(15 * 60_000);
  });

  it('acepta lo reciente', () => {
    expect(isRecentlyAuthenticated(AHORA, AHORA)).toBe(true);
    expect(isRecentlyAuthenticated(haceMinutos(14), AHORA)).toBe(true);
  });

  it('CRÍTICO: deniega pasada la ventana', () => {
    expect(isRecentlyAuthenticated(haceMinutos(15), AHORA)).toBe(false);
    expect(isRecentlyAuthenticated(haceMinutos(60), AHORA)).toBe(false);
  });

  it('CRÍTICO: una sesión que nunca se reautenticó no está dentro de nada', () => {
    // Fail-closed ante la ausencia. Es el caso normal —una sesión recién abierta no ha
    // demostrado nada más allá de la contraseña— y tiene que denegar sin excepciones.
    expect(isRecentlyAuthenticated(null, AHORA)).toBe(false);
    expect(isRecentlyAuthenticated(undefined, AHORA)).toBe(false);
  });

  it('CRÍTICO: una fecha en el futuro tampoco vale', () => {
    // Solo puede venir de un reloj desviado o de una escritura corrupta, y ninguna de las dos
    // es motivo para dar permiso.
    const futuro = new Date(AHORA.getTime() + 60_000);

    expect(isRecentlyAuthenticated(futuro, AHORA)).toBe(false);
  });

  it('dice hasta cuándo vale, para que la interfaz no lo adivine', () => {
    expect(reauthenticatedUntil(AHORA).getTime()).toBe(
      AHORA.getTime() + REAUTH_WINDOW_MS,
    );
  });
});

describe('el catálogo de acciones sensibles', () => {
  /**
   * La lista literal, escrita a mano. Añadir una acción hace fallar esta prueba a propósito:
   * marcar una ruta como sensible es una decisión de seguridad, y que alguien tenga que venir
   * aquí y reescribir la lista es exactamente el momento en que se piensa si estaba bien.
   */
  it('contiene exactamente estas acciones', () => {
    expect(Object.values(SENSITIVE_ACTIONS).sort()).toEqual(
      [
        'mfa.disable',
        'mfa.recovery_codes.regenerate',
        'mfa.remove_from_member',
        'mfa.remove_from_platform',
        'organization.erase',
        'organization.export',
        'organization.plan_change',
        'password.change',
        'platform_access.approve',
        'platform_access.request',
        'platform_access.revoke',
        'user.ban',
      ].sort(),
    );
  });

  it('ninguna se repite', () => {
    const valores = Object.values(SENSITIVE_ACTIONS);

    expect(new Set(valores).size).toBe(valores.length);
  });
});

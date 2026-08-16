import {
  OAUTH_STATE_TTL_MS,
  buildStatePayload,
  generateNonce,
  grantedScopesAreSufficient,
  hashNonce,
  verifyStatePayload,
} from './oauth-state';

/**
 * El callback de OAuth es la superficie más expuesta de una integración: llega por GET, desde
 * el navegador, sin sesión aplicativa. Estas pruebas se escriben desde el lado del atacante.
 */
describe('estado del flujo OAuth', () => {
  const nonce = generateNonce();
  const payload = buildStatePayload({
    organizationId: 'org-1',
    userId: 'user-1',
    nonce,
    now: 1_000_000,
  });

  it('acepta la vuelta del navegador que inició el flujo', () => {
    expect(
      verifyStatePayload({
        payload,
        nonceFromCookie: nonce,
        now: 1_000_000 + 5_000,
      }),
    ).toEqual({ valid: true, organizationId: 'org-1', userId: 'user-1' });
  });

  it('el nonce en claro NUNCA viaja en el estado, solo su hash', () => {
    // El estado va por la URL: queda en historiales, registros de proxy y cabeceras Referer.
    expect(JSON.stringify(payload)).not.toContain(nonce);
    expect(payload.nonceHash).toBe(hashNonce(nonce));
  });

  describe('CRÍTICO: sin la cookie del navegador que empezó, se RECHAZA', () => {
    it('sin cookie', () => {
      // Es el ataque: un tercero provoca la vuelta con SU código para dejar la cuenta de la
      // víctima conectada a SU Drive. Sin la cookie no puede.
      expect(
        verifyStatePayload({
          payload,
          nonceFromCookie: undefined,
          now: 1_000_100,
        }),
      ).toEqual({ valid: false, reason: 'MISSING_NONCE' });
    });

    it('con una cookie que no corresponde', () => {
      expect(
        verifyStatePayload({
          payload,
          nonceFromCookie: generateNonce(),
          now: 1_000_100,
        }),
      ).toEqual({ valid: false, reason: 'NONCE_MISMATCH' });
    });

    it('con una cookie vacía', () => {
      expect(
        verifyStatePayload({ payload, nonceFromCookie: '', now: 1_000_100 }),
      ).toMatchObject({ valid: false });
    });
  });

  describe('la ventana del flujo está acotada', () => {
    it('caduca pasado el plazo', () => {
      expect(
        verifyStatePayload({
          payload,
          nonceFromCookie: nonce,
          now: 1_000_000 + OAUTH_STATE_TTL_MS + 1,
        }),
      ).toEqual({ valid: false, reason: 'EXPIRED' });
    });

    it('un estado del FUTURO tampoco vale', () => {
      // No puede venir de un flujo nuestro; aceptarlo daría una ventana ilimitada.
      expect(
        verifyStatePayload({
          payload,
          nonceFromCookie: nonce,
          now: 999_000,
        }),
      ).toEqual({ valid: false, reason: 'EXPIRED' });
    });
  });

  describe('quién conecta y para qué organización viaja FIRMADO', () => {
    it.each([
      ['sin organización', { ...payload, organizationId: '' }],
      ['sin usuario', { ...payload, userId: '' }],
      ['sin hash de nonce', { ...payload, nonceHash: undefined }],
      ['sin fecha', { ...payload, issuedAt: 'ayer' }],
      ['no es un objeto', 'basura'],
      ['nulo', null],
    ])('RECHAZA un estado %s', (_caso, malformado) => {
      // Leerlo de un parámetro suelto permitiría conectar el Drive propio a la organización
      // de otro: por eso va dentro del estado firmado y por eso se valida entero.
      expect(
        verifyStatePayload({
          payload: malformado,
          nonceFromCookie: nonce,
          now: 1_000_100,
        }),
      ).toMatchObject({ valid: false, reason: 'MALFORMED' });
    });
  });
});

describe('grantedScopesAreSufficient', () => {
  it('acepta el permiso de solo lectura que se pide', () => {
    expect(
      grantedScopesAreSufficient(
        'https://www.googleapis.com/auth/drive.readonly openid',
      ),
    ).toBe(true);
  });

  it('acepta el permiso completo, que lo incluye', () => {
    expect(
      grantedScopesAreSufficient('https://www.googleapis.com/auth/drive'),
    ).toBe(true);
  });

  it('CRÍTICO: RECHAZA si la persona concedió menos de lo necesario', () => {
    // La pantalla de Google permite desmarcar permisos. Dar la conexión por buena dejaría una
    // fuente que falla en cada sincronización sin que nadie entienda por qué.
    expect(grantedScopesAreSufficient('openid email')).toBe(false);
    expect(grantedScopesAreSufficient('')).toBe(false);
  });
});

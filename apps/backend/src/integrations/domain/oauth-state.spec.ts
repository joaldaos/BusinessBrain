import {
  GMAIL_SCOPES,
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
    provider: 'GOOGLE_DRIVE',
    nonce,
    now: 1_000_000,
  });

  it('acepta la vuelta del navegador que inició el flujo', () => {
    expect(
      verifyStatePayload({
        payload,
        nonceFromCookie: nonce,
        expectedProvider: 'GOOGLE_DRIVE',
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
          expectedProvider: 'GOOGLE_DRIVE',
          now: 1_000_100,
        }),
      ).toEqual({ valid: false, reason: 'MISSING_NONCE' });
    });

    it('con una cookie que no corresponde', () => {
      expect(
        verifyStatePayload({
          payload,
          nonceFromCookie: generateNonce(),
          expectedProvider: 'GOOGLE_DRIVE',
          now: 1_000_100,
        }),
      ).toEqual({ valid: false, reason: 'NONCE_MISMATCH' });
    });

    it('con una cookie vacía', () => {
      expect(
        verifyStatePayload({
          payload,
          nonceFromCookie: '',
          expectedProvider: 'GOOGLE_DRIVE',
          now: 1_000_100,
        }),
      ).toMatchObject({ valid: false });
    });
  });

  describe('la ventana del flujo está acotada', () => {
    it('caduca pasado el plazo', () => {
      expect(
        verifyStatePayload({
          payload,
          nonceFromCookie: nonce,
          expectedProvider: 'GOOGLE_DRIVE',
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
          expectedProvider: 'GOOGLE_DRIVE',
          now: 999_000,
        }),
      ).toEqual({ valid: false, reason: 'EXPIRED' });
    });
  });

  describe('CRÍTICO: un estado de OTRO proveedor no completa esta conexión', () => {
    it('RECHAZA un estado de Drive en el callback de Gmail', () => {
      // Mismo secreto de firma y misma cookie de nonce: sin atar el estado al proveedor, un
      // flujo legítimo de Drive serviría para dar por conectado un BUZÓN, que es una superficie
      // completamente distinta.
      expect(
        verifyStatePayload({
          payload,
          nonceFromCookie: nonce,
          expectedProvider: 'GMAIL',
          now: 1_000_100,
        }),
      ).toEqual({ valid: false, reason: 'PROVIDER_MISMATCH' });
    });

    it('RECHAZA un estado sin proveedor', () => {
      // Un estado de antes de esta garantía tampoco vale: fail-closed.
      expect(
        verifyStatePayload({
          payload: { ...payload, provider: undefined },
          nonceFromCookie: nonce,
          expectedProvider: 'GOOGLE_DRIVE',
          now: 1_000_100,
        }),
      ).toEqual({ valid: false, reason: 'PROVIDER_MISMATCH' });
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
          expectedProvider: 'GOOGLE_DRIVE',
          now: 1_000_100,
        }),
      ).toMatchObject({ valid: false, reason: 'MALFORMED' });
    });
  });
});

describe('grantedScopesAreSufficient', () => {
  it('acepta el permiso de solo lectura que se pide, por proveedor', () => {
    expect(
      grantedScopesAreSufficient(
        'GOOGLE_DRIVE',
        'https://www.googleapis.com/auth/drive.readonly openid',
      ),
    ).toBe(true);
    expect(
      grantedScopesAreSufficient(
        'GMAIL',
        'https://www.googleapis.com/auth/gmail.readonly openid',
      ),
    ).toBe(true);
  });

  it('acepta el permiso amplio, que lo incluye', () => {
    expect(
      grantedScopesAreSufficient(
        'GOOGLE_DRIVE',
        'https://www.googleapis.com/auth/drive',
      ),
    ).toBe(true);
    expect(
      grantedScopesAreSufficient('GMAIL', 'https://mail.google.com/'),
    ).toBe(true);
  });

  it('CRÍTICO: el permiso de un proveedor NO vale para el otro', () => {
    // Sin esta comprobación, conectar Gmail se daría por bueno con un consentimiento de solo
    // Drive y la primera sincronización fallaría contra una API a la que ese token no llega.
    expect(
      grantedScopesAreSufficient(
        'GMAIL',
        'https://www.googleapis.com/auth/drive.readonly',
      ),
    ).toBe(false);
    expect(
      grantedScopesAreSufficient(
        'GOOGLE_DRIVE',
        'https://www.googleapis.com/auth/gmail.readonly',
      ),
    ).toBe(false);
  });

  it('CRÍTICO: RECHAZA si la persona concedió menos de lo necesario', () => {
    // La pantalla de Google permite desmarcar permisos. Dar la conexión por buena dejaría una
    // fuente que falla en cada sincronización sin que nadie entienda por qué.
    expect(grantedScopesAreSufficient('GOOGLE_DRIVE', 'openid email')).toBe(
      false,
    );
    expect(grantedScopesAreSufficient('GMAIL', '')).toBe(false);
  });

  it('el permiso de Gmail es SOLO de lectura: nada de envío ni de modificación', () => {
    // Cerrado por construcción, no por convención: la lista de permisos es la que se pide.
    expect(GMAIL_SCOPES).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
    ]);
  });
});

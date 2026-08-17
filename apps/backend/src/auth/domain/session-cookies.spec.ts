import {
  csrfTokenMatches,
  generateCsrfToken,
  oauthFlowCookieOptions,
  sessionCookieOptions,
} from './session-cookies';

describe('oauthFlowCookieOptions', () => {
  const options = (isProduction = true) =>
    oauthFlowCookieOptions({ isProduction, maxAgeMs: 1000 });

  it('CRÍTICO: es SameSite=Lax, porque la vuelta de Google es cruzada', () => {
    // Con `Strict` el navegador NO adjunta la cookie al volver de la pantalla de
    // consentimiento, la verificación del nonce falla siempre y conectar cualquier integración
    // de Google es imposible en un navegador real — aunque los tests HTTP pasen, porque ahí la
    // cookie se pone a mano.
    expect(options().sameSite).toBe('lax');
  });

  it('sigue siendo ilegible por cualquier script', () => {
    // Lax permite el único caso legítimo (una navegación de vuelta) y nada más: el nonce en
    // claro no puede leerse desde la página.
    expect(options().httpOnly).toBe(true);
  });

  it('NO relaja la cookie de sesión, que sigue siendo Strict', () => {
    // Viven en funciones separadas precisamente para que esto no pueda pasar por descuido.
    const session = sessionCookieOptions({ isProduction: true, maxAgeMs: 1000 });
    expect(session.refresh.sameSite).toBe('strict');
    expect(session.csrf.sameSite).toBe('strict');
  });

  it('secure solo fuera de desarrollo, como las de sesión', () => {
    expect(options(true).secure).toBe(true);
    expect(options(false).secure).toBe(false);
  });
});

describe('sessionCookieOptions', () => {
  const options = (isProduction: boolean) =>
    sessionCookieOptions({ isProduction, maxAgeMs: 1000 });

  it('el refresco NO es legible por ningún script', () => {
    // Es la razón entera del cambio: un XSS ya no puede llevarse la sesión de larga vida.
    expect(options(true).refresh.httpOnly).toBe(true);
  });

  it('el testigo CSRF SÍ es legible: la interfaz debe repetirlo', () => {
    expect(options(true).csrf.httpOnly).toBe(false);
  });

  it('ambas son SameSite=Strict: el navegador no las adjunta desde otro sitio', () => {
    expect(options(true).refresh.sameSite).toBe('strict');
    expect(options(true).csrf.sameSite).toBe('strict');
  });

  it('en producción exige HTTPS', () => {
    expect(options(true).refresh.secure).toBe(true);
  });

  it('en desarrollo NO, o la sesión no funcionaría en local', () => {
    // Una cookie `Secure` sobre http://localhost sencillamente no se guarda.
    expect(options(false).refresh.secure).toBe(false);
  });

  it('el camino es la raíz, no /auth', () => {
    // Detrás de un proxy la interfaz llama a `/api/auth/refresh`: una cookie fijada en
    // `/auth` no llegaría, y la sesión se caería en producción y no en desarrollo.
    expect(options(true).refresh.path).toBe('/');
  });
});

describe('generateCsrfToken', () => {
  it('produce un valor largo y distinto cada vez', () => {
    const first = generateCsrfToken();
    const second = generateCsrfToken();

    expect(first).toHaveLength(64);
    expect(first).not.toBe(second);
  });
});

describe('csrfTokenMatches', () => {
  it('acepta el testigo repetido correctamente', () => {
    const token = generateCsrfToken();
    expect(csrfTokenMatches(token, token)).toBe(true);
  });

  it('RECHAZA un testigo distinto', () => {
    expect(csrfTokenMatches(generateCsrfToken(), generateCsrfToken())).toBe(
      false,
    );
  });

  describe('fail-closed ante cualquier ausencia', () => {
    it.each([
      ['sin cookie', undefined, 'algo'],
      ['sin cabecera', 'algo', undefined],
      ['ambos ausentes', undefined, undefined],
      ['cookie vacía', '', ''],
      ['tipos que no son texto', 123, 123],
      ['longitudes distintas', 'abc', 'abcd'],
    ])('%s', (_caso, cookie, header) => {
      // Un atacante de otro origen puede provocar la petición, pero no puede leer la cookie
      // para componer la cabecera: sin coincidencia, no hay sesión.
      expect(csrfTokenMatches(cookie, header)).toBe(false);
    });
  });
});

import { http, prisma, startTestApp, stopTestApp } from './harness';

/**
 * El ciclo de sesión con el refresco fuera del alcance de cualquier script.
 *
 * Se verifica por HTTP porque lo que cambió es el TRANSPORTE: qué sale en el cuerpo, qué sale
 * en cabeceras `Set-Cookie` y con qué atributos. Nada de eso se puede comprobar llamando al
 * servicio directamente.
 */
describe('Sesión por cookie (E2E)', () => {
  const unique = Math.random().toString(36).slice(2, 8);
  const email = `sesion-${unique}@e2e.local`;
  const password = 'contrasena-de-prueba';
  const userIds: string[] = [];

  beforeAll(async () => {
    await startTestApp();
    const registered = await http()
      .post('/auth/register')
      .send({ email, password, name: 'Sesión' })
      .expect(201);
    userIds.push(userIdOf(registered));
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await stopTestApp();
  });

  /** Extrae una cookie concreta de las cabeceras `Set-Cookie`. */
  const cookieFrom = (
    headers: Record<string, string[] | string | undefined>,
    name: string,
  ): string | undefined => {
    const raw = headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.find((cookie) => cookie.startsWith(`${name}=`));
  };

  const valueOf = (cookie: string): string =>
    cookie.split(';')[0].split('=').slice(1).join('=');

  const login = () =>
    http().post('/auth/login').send({ email, password }).expect(201);

  /** El testigo que devuelve el cuerpo, tipado: `supertest` entrega `body` sin tipar. */
  const csrfOf = (response: { body: unknown }): string =>
    (response.body as { data: { csrfToken: string } }).data.csrfToken;

  const userIdOf = (response: { body: unknown }): string =>
    (response.body as { data: { id: string } }).data.id;

  describe('login', () => {
    it('CRÍTICO: el token de refresco NO sale en el cuerpo', async () => {
      const response = await login();

      // Es la razón entera del cambio. Si volviera aquí, un XSS podría leerlo del JSON.
      expect(response.body.data.refreshToken).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toMatch(/refreshToken/i);

      // Lo que sí vuelve: el de acceso, de vida corta, y el testigo CSRF.
      expect(response.body.data.accessToken).toBeTruthy();
      expect(response.body.data.csrfToken).toBeTruthy();
    });

    it('el refresco viaja en una cookie que ningún script puede leer', async () => {
      const response = await login();
      const cookie = cookieFrom(response.headers, 'bb_refresh');

      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/i);
      // El navegador no la adjunta en peticiones originadas fuera del sitio.
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\//);
    });

    it('el testigo CSRF SÍ es legible: la interfaz debe repetirlo', async () => {
      const response = await login();
      const cookie = cookieFrom(response.headers, 'bb_csrf');

      expect(cookie).toBeDefined();
      expect(cookie).not.toMatch(/HttpOnly/i);
      // Y coincide con el que vino en el cuerpo: son el mismo valor.
      expect(valueOf(cookie!)).toBe(csrfOf(response));
    });
  });

  describe('refresh', () => {
    it('renueva la sesión con la cookie y el testigo', async () => {
      const first = await login();
      const refreshCookie = cookieFrom(first.headers, 'bb_refresh')!;
      const csrfCookie = cookieFrom(first.headers, 'bb_csrf')!;

      const renewed = await http()
        .post('/auth/refresh')
        .set('Cookie', [refreshCookie, csrfCookie])
        .set('x-csrf-token', csrfOf(first))
        .expect(201);

      expect(renewed.body.data.accessToken).toBeTruthy();
      expect(renewed.body.data.refreshToken).toBeUndefined();
      // Rotación: la cookie nueva no es la anterior.
      expect(valueOf(cookieFrom(renewed.headers, 'bb_refresh')!)).not.toBe(
        valueOf(refreshCookie),
      );
    });

    it('el token usado queda REVOCADO: no sirve dos veces', async () => {
      const first = await login();
      const refreshCookie = cookieFrom(first.headers, 'bb_refresh')!;
      const csrfCookie = cookieFrom(first.headers, 'bb_csrf')!;
      const cookies = [refreshCookie, csrfCookie];

      await http()
        .post('/auth/refresh')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfOf(first))
        .expect(201);

      // Reutilizar el mismo es exactamente lo que haría quien lo robó.
      await http()
        .post('/auth/refresh')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrfOf(first))
        .expect(401);
    });

    it('sin cookie de refresco no hay sesión que renovar', async () => {
      const first = await login();

      await http()
        .post('/auth/refresh')
        .set('Cookie', [cookieFrom(first.headers, 'bb_csrf')!])
        .set('x-csrf-token', csrfOf(first))
        .expect(401);
    });

    it('el token en el CUERPO ya no sirve: la puerta antigua está cerrada', async () => {
      const first = await login();

      // Aceptarlo dejaría abierta exactamente la vía que este cambio cierra.
      await http()
        .post('/auth/refresh')
        .send({
          refreshToken: valueOf(cookieFrom(first.headers, 'bb_refresh')!),
        })
        .expect(403);
    });
  });

  describe('CRÍTICO: protección CSRF', () => {
    it('sin la cabecera del testigo, RECHAZA', async () => {
      const first = await login();

      // Es el escenario del ataque: el navegador de la víctima adjunta la cookie sola, pero
      // el sitio atacante no puede leerla para componer la cabecera.
      await http()
        .post('/auth/refresh')
        .set('Cookie', [
          cookieFrom(first.headers, 'bb_refresh')!,
          cookieFrom(first.headers, 'bb_csrf')!,
        ])
        .expect(403);
    });

    it('con un testigo QUE NO COINCIDE, RECHAZA', async () => {
      const first = await login();

      await http()
        .post('/auth/refresh')
        .set('Cookie', [
          cookieFrom(first.headers, 'bb_refresh')!,
          cookieFrom(first.headers, 'bb_csrf')!,
        ])
        .set('x-csrf-token', 'a'.repeat(64))
        .expect(403);
    });

    it('cerrar sesión también está protegido', async () => {
      const first = await login();

      // Sin esto, un tercero podría cerrarle la sesión a cualquiera.
      await http()
        .post('/auth/logout')
        .set('Cookie', [cookieFrom(first.headers, 'bb_refresh')!])
        .expect(403);
    });

    it('el resto de la API NO exige testigo: no lo necesita', async () => {
      // Se autentica con `Authorization`, que el navegador nunca adjunta por su cuenta.
      const first = await login();

      await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${first.body.data.accessToken}`)
        .expect(200);
    });
  });

  describe('logout', () => {
    it('revoca el token y BORRA las cookies', async () => {
      const first = await login();
      const refreshCookie = cookieFrom(first.headers, 'bb_refresh')!;

      const response = await http()
        .post('/auth/logout')
        .set('Cookie', [refreshCookie, cookieFrom(first.headers, 'bb_csrf')!])
        .set('x-csrf-token', csrfOf(first))
        .expect(201);

      // Las cookies se vacían: dejar una muerta haría que cada arranque intentara refrescar
      // contra algo que ya no existe.
      const cleared = cookieFrom(response.headers, 'bb_refresh');
      expect(cleared).toBeDefined();
      expect(valueOf(cleared!)).toBe('');

      // Y el token deja de servir de verdad, no solo en el navegador.
      await http()
        .post('/auth/refresh')
        .set('Cookie', [refreshCookie, cookieFrom(first.headers, 'bb_csrf')!])
        .set('x-csrf-token', csrfOf(first))
        .expect(401);
    });
  });

  describe('expiración y revocación', () => {
    it('un token caducado no renueva nada', async () => {
      const first = await login();
      const refreshCookie = cookieFrom(first.headers, 'bb_refresh')!;

      // Se caduca en la base de datos: es lo que ocurriría con el paso del tiempo.
      await prisma.refreshToken.updateMany({
        where: { user: { email } },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await http()
        .post('/auth/refresh')
        .set('Cookie', [refreshCookie, cookieFrom(first.headers, 'bb_csrf')!])
        .set('x-csrf-token', csrfOf(first))
        .expect(401);
    });

    it('un token revocado a mano tampoco', async () => {
      const first = await login();
      const refreshCookie = cookieFrom(first.headers, 'bb_refresh')!;

      // Es lo que haría un administrador al expulsar a alguien.
      await prisma.refreshToken.updateMany({
        where: { user: { email }, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await http()
        .post('/auth/refresh')
        .set('Cookie', [refreshCookie, cookieFrom(first.headers, 'bb_csrf')!])
        .set('x-csrf-token', csrfOf(first))
        .expect(401);
    });
  });
});

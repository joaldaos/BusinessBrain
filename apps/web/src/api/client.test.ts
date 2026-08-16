import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, session } from './client';

/**
 * El cliente HTTP es la única pieza del frontend con reglas propias, y todas son de seguridad
 * o de continuidad de sesión. Lo demás es presentación.
 */
describe('cliente de API', () => {
  const fetchMock = vi.fn();

  /** Simula la cookie legible del testigo. La del refresco es invisible aquí a propósito. */
  const setCsrfCookie = (value: string | null) => {
    document.cookie = value
      ? `bb_csrf=${value}`
      : 'bb_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    localStorage.clear();
    setCsrfCookie(null);
    session.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ok = (data: unknown) =>
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const headersOf = (call: number) =>
    (fetchMock.mock.calls[call] as [string, RequestInit])[1]
      .headers as Record<string, string>;

  it('envía la organización activa en cada llamada', async () => {
    // `OrgRoleGuard` la resuelve desde esta cabecera: sin ella, la API no sabe de qué empresa
    // se está hablando y responde 404.
    session.selectOrganization('org-1');
    fetchMock.mockResolvedValue(ok([]));

    await api('/insights');

    expect(headersOf(0)['x-org-id']).toBe('org-1');
  });

  it('no la envía en las rutas que no la resuelven', async () => {
    session.selectOrganization('org-1');
    fetchMock.mockResolvedValue(ok({}));

    await api('/auth/me', { withoutOrganization: true });

    expect(headersOf(0)['x-org-id']).toBeUndefined();
  });

  describe('la sesión de larga vida NO está en este código', () => {
    it('el token de refresco no se guarda en ninguna parte accesible', () => {
      session.start({ accessToken: 'a', csrfToken: 'c' });

      // Es la razón entera del cambio: un XSS ya no puede llevarse la sesión. Lo único que
      // queda del lado del navegador es la cookie `HttpOnly`, ilegible desde JavaScript.
      expect(JSON.stringify(localStorage)).not.toContain('a');
      expect(Object.keys(localStorage)).not.toContain('bb.refreshToken');
      expect(session).not.toHaveProperty('refreshToken');
    });

    it('las peticiones se hacen con las cookies del propio origen', async () => {
      fetchMock.mockResolvedValue(ok([]));
      await api('/insights');

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.credentials).toBe('same-origin');
    });
  });

  describe('protección CSRF', () => {
    it('repite el testigo en la cabecera al refrescar', async () => {
      // Doble envío: un sitio de terceros puede provocar la petición, pero no puede leer la
      // cookie para componer esta cabecera.
      setCsrfCookie('testigo-123');
      fetchMock
        .mockResolvedValueOnce(new Response('', { status: 401 }))
        .mockResolvedValueOnce(ok({ accessToken: 'nuevo', csrfToken: 't2' }))
        .mockResolvedValueOnce(ok([]));

      await api('/insights');

      const refreshCall = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(refreshCall[0]).toBe('/api/auth/refresh');
      expect(
        (refreshCall[1].headers as Record<string, string>)['x-csrf-token'],
      ).toBe('testigo-123');
    });

    it('las rutas normales NO lo mandan: no lo necesitan', async () => {
      // Se autentican con `Authorization`, que el navegador nunca adjunta por su cuenta.
      setCsrfCookie('testigo-123');
      fetchMock.mockResolvedValue(ok([]));

      await api('/insights');

      expect(headersOf(0)['x-csrf-token']).toBeUndefined();
    });
  });

  describe('continuidad de la sesión', () => {
    it('renueva ante un 401 y reintenta UNA vez', async () => {
      setCsrfCookie('testigo-123');
      fetchMock
        .mockResolvedValueOnce(new Response('', { status: 401 }))
        .mockResolvedValueOnce(ok({ accessToken: 'nuevo', csrfToken: 't2' }))
        .mockResolvedValueOnce(ok([{ id: 'i1' }]));

      const result = await api<{ id: string }[]>('/insights');

      expect(result).toEqual([{ id: 'i1' }]);
      expect(session.accessToken).toBe('nuevo');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('sin cookie de sesión NO intenta renovar', async () => {
      // Tras cerrar sesión o en la pantalla de login no hay nada que refrescar.
      fetchMock.mockResolvedValue(new Response('', { status: 401 }));

      await expect(api('/insights')).rejects.toBeInstanceOf(ApiError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('si la renovación falla, la sesión local se limpia', async () => {
      setCsrfCookie('caducado');
      fetchMock
        .mockResolvedValueOnce(new Response('', { status: 401 }))
        .mockResolvedValueOnce(new Response('', { status: 401 }));

      await expect(api('/insights')).rejects.toBeInstanceOf(ApiError);
      expect(session.accessToken).toBeNull();
    });

    it('un 401 en el propio refresco no se reintenta en bucle', async () => {
      setCsrfCookie('caducado');
      fetchMock.mockResolvedValue(new Response('', { status: 401 }));

      await expect(
        api('/auth/refresh', { method: 'POST', withCsrf: true }),
      ).rejects.toBeInstanceOf(ApiError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('los errores del backend llegan intactos', () => {
    it('conserva el mensaje: explica POR QUÉ deniega', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'Se apoya en colecciones a las que no tienes acceso concedido',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      await expect(api('/insights/x')).rejects.toMatchObject({
        status: 403,
        message: 'Se apoya en colecciones a las que no tienes acceso concedido',
      });
    });

    it('agrupa los errores de validación en un mensaje legible', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: ['name no puede estar vacío', 'limit inválido'] },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      await expect(api('/reports')).rejects.toMatchObject({
        message: 'name no puede estar vacío. limit inválido',
      });
    });
  });
});

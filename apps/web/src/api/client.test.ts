import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, session } from './client';

/**
 * El cliente HTTP es la única pieza del frontend con reglas propias, y todas son de seguridad
 * o de continuidad de sesión. Lo demás es presentación.
 */
describe('cliente de API', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    localStorage.clear();
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

  it('envía la organización activa en cada llamada', async () => {
    // `OrgRoleGuard` la resuelve desde esta cabecera: sin ella, la API no sabe de qué empresa
    // se está hablando y responde 404.
    session.selectOrganization('org-1');
    fetchMock.mockResolvedValue(ok([]));

    await api('/insights');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-org-id']).toBe('org-1');
  });

  it('no la envía en las rutas que no la resuelven', async () => {
    session.selectOrganization('org-1');
    fetchMock.mockResolvedValue(ok({}));

    await api('/auth/me', { withoutOrganization: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-org-id']).toBeUndefined();
  });

  it('renueva el token ante un 401 y reintenta UNA vez', async () => {
    // Sin esto la sesión se caería a mitad de cualquier flujo al vencer el token de acceso.
    session.start({ accessToken: 'viejo', refreshToken: 'refresco' });

    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(
        ok({ accessToken: 'nuevo', refreshToken: 'refresco-2' }),
      )
      .mockResolvedValueOnce(ok([{ id: 'i1' }]));

    const result = await api<{ id: string }[]>('/insights');

    expect(result).toEqual([{ id: 'i1' }]);
    expect(session.accessToken).toBe('nuevo');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('si el refresco falla, la sesión se limpia en vez de quedar rota', async () => {
    session.start({ accessToken: 'viejo', refreshToken: 'caducado' });
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }));

    await expect(api('/insights')).rejects.toBeInstanceOf(ApiError);
    expect(session.accessToken).toBeNull();
    expect(session.refreshToken).toBeNull();
  });

  it('conserva el mensaje del backend: explica POR QUÉ deniega', async () => {
    // El backend dice qué colecciones faltan o por qué un escalado exige curación propia.
    // Reescribirlo aquí perdería justo la parte útil.
    session.start({ accessToken: 'a', refreshToken: 'r' });
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

  it('agrupa los errores de validación en un solo mensaje legible', async () => {
    session.start({ accessToken: 'a', refreshToken: 'r' });
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

  it('un 401 sin refresco no intenta renovar', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));

    await expect(api('/insights')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

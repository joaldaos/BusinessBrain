/**
 * Cliente HTTP contra la API de BusinessBrain.
 *
 * ## El frontend NUNCA amplía autorización
 *
 * Todo lo que decide quién puede hacer qué vive en el backend: `JwtAuthGuard`, `OrgRoleGuard`,
 * `@OrgRoles` y el alcance de colección de 6.3. Esta capa se limita a llevar el token y la
 * organización activa, y a mostrar lo que la API devuelva. Cuando la interfaz oculta un botón
 * lo hace por comodidad de lectura, jamás como control: la misma llamada hecha a mano seguiría
 * respondiendo 403.
 *
 * ## Dónde viven los tokens
 *
 * El de acceso, en memoria; el de refresco, en `localStorage`. No es la opción ideal —un XSS
 * podría leerlo—, pero el backend no emite cookies `httpOnly` todavía y la alternativa sería
 * perder la sesión en cada recarga. Queda anotado como deuda consciente, no como descuido: el
 * cambio a cookies de sesión es de backend, no de aquí.
 */

const REFRESH_TOKEN_KEY = 'bb.refreshToken';
const ORGANIZATION_KEY = 'bb.organizationId';

/** Toda respuesta 2xx de la API viene envuelta por `TransformResponseInterceptor`. */
interface ApiEnvelope<T> {
  data: T;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** El backend distingue 403 de 404 a propósito; la interfaz debe respetarlo. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

let accessToken: string | null = null;

export const session = {
  get accessToken() {
    return accessToken;
  },
  get refreshToken() {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },
  get organizationId() {
    return localStorage.getItem(ORGANIZATION_KEY);
  },
  start(tokens: { accessToken: string; refreshToken: string }) {
    accessToken = tokens.accessToken;
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  },
  selectOrganization(organizationId: string) {
    localStorage.setItem(ORGANIZATION_KEY, organizationId);
  },
  clear() {
    accessToken = null;
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(ORGANIZATION_KEY);
  },
};

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Omite la cabecera de organización: solo para rutas que no la resuelven. */
  withoutOrganization?: boolean;
  /** Devuelve la respuesta cruda en vez de leerla como JSON (descargas). */
  raw?: boolean;
}

function buildHeaders(options: RequestOptions): HeadersInit {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const organizationId = session.organizationId;
  // `OrgRoleGuard` resuelve la organización desde la ruta o desde esta cabecera. Como casi
  // ninguna ruta lleva el id en el path, esta cabecera es la vía normal.
  if (organizationId && !options.withoutOrganization) {
    headers['x-org-id'] = organizationId;
  }

  return headers;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: string | { message?: string | string[] };
    };
    const error = body.error;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      const { message } = error;
      if (Array.isArray(message)) return message.join('. ');
      if (typeof message === 'string') return message;
    }
  } catch {
    // Una respuesta sin cuerpo JSON no debe tapar el código de estado, que sí es informativo.
  }
  return `Error ${response.status}`;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  return fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: buildHeaders(options),
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

/**
 * Renueva el token de acceso una sola vez ante un 401 y reintenta.
 *
 * Sin esto, la sesión se caería cada quince minutos en mitad de cualquier flujo. Si el
 * refresco también falla, se limpia la sesión: es preferible volver al login a dejar la
 * interfaz en un estado en el que todo responde 401 sin explicación.
 */
let refreshing: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = session.refreshToken;
  if (!refreshToken) return false;

  refreshing ??= (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;

      const body = (await response.json()) as ApiEnvelope<{
        accessToken: string;
        refreshToken: string;
      }>;
      session.start(body.data);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

export async function api<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  let response = await send(path, options);

  if (response.status === 401 && session.refreshToken) {
    const renewed = await refreshAccessToken();
    if (renewed) {
      response = await send(path, options);
    } else {
      session.clear();
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }

  if (options.raw) return response as unknown as T;
  if (response.status === 204) return undefined as T;

  const body = (await response.json()) as ApiEnvelope<T>;
  return body.data;
}

/** Descarga un fichero generado por la API (hoy, el PDF de un informe). */
export async function download(
  path: string,
  options: RequestOptions = {},
): Promise<{ blob: Blob; fileName: string }> {
  const response = await api<Response>(path, { ...options, raw: true });

  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);

  return {
    blob: await response.blob(),
    fileName: match?.[1] ?? 'descarga.pdf',
  };
}

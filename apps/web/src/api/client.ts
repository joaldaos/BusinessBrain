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
 * El de acceso, en memoria. **El de refresco no está aquí**: viaja en una cookie `HttpOnly`
 * que este código no puede leer ni escribir, y el navegador la adjunta solo. Ese es el punto —
 * un XSS ya no puede llevarse la sesión de larga vida.
 *
 * Lo único que esta capa custodia de la sesión es el testigo CSRF, que no es un secreto: su
 * valor está en que quien ataca desde otro origen no puede leerlo para repetirlo en la
 * cabecera.
 */

const CSRF_COOKIE = 'bb_csrf';
const CSRF_HEADER = 'x-csrf-token';
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
let csrfToken: string | null = null;

/** Lee el testigo de su cookie. Tras una recarga es lo único que queda de la sesión. */
function readCsrfCookie(): string | null {
  const match = new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`).exec(
    document.cookie,
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export const session = {
  get accessToken() {
    return accessToken;
  },
  get csrfToken() {
    return csrfToken ?? readCsrfCookie();
  },
  /**
   * ¿Puede haber una sesión que recuperar?
   *
   * La cookie del refresco es invisible para este código, así que se pregunta por la del
   * testigo, que acompaña siempre a la otra. Es solo una pista para no intentar refrescar
   * cuando es evidente que no hay nada: quien decide de verdad es el servidor.
   */
  get maybeAuthenticated() {
    return readCsrfCookie() !== null;
  },
  get organizationId() {
    return localStorage.getItem(ORGANIZATION_KEY);
  },
  start(tokens: { accessToken: string; csrfToken?: string }) {
    accessToken = tokens.accessToken;
    if (tokens.csrfToken) csrfToken = tokens.csrfToken;
  },
  selectOrganization(organizationId: string) {
    localStorage.setItem(ORGANIZATION_KEY, organizationId);
  },
  clear() {
    accessToken = null;
    csrfToken = null;
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
  /** Rutas autenticadas POR COOKIE: exigen repetir el testigo CSRF. */
  withCsrf?: boolean;
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

  // Doble envío: el mismo valor que lleva la cookie legible. Un sitio de terceros puede
  // provocar la petición, pero no puede leer la cookie para componer esta cabecera.
  if (options.withCsrf) {
    const token = session.csrfToken;
    if (token) headers[CSRF_HEADER] = token;
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
    // Mismo origen a través del proxy, así que el navegador ya adjuntaría las cookies; se
    // declara igualmente para que el comportamiento no dependa de cómo se despliegue.
    credentials: 'same-origin',
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

export async function refreshAccessToken(): Promise<boolean> {
  // El token de refresco no está aquí: lo lleva el navegador en una cookie `HttpOnly`. Lo
  // único que este código aporta es el testigo CSRF.
  if (!session.maybeAuthenticated) return false;

  refreshing ??= (async () => {
    try {
      const response = await send('/auth/refresh', {
        method: 'POST',
        withoutOrganization: true,
        withCsrf: true,
      });
      if (!response.ok) return false;

      const body = (await response.json()) as ApiEnvelope<{
        accessToken: string;
        csrfToken: string;
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

  if (response.status === 401 && session.maybeAuthenticated && !options.withCsrf) {
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

import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Transporte de la sesión: cookies y protección CSRF.
 *
 * ## Por qué el refresco deja de viajar en el cuerpo
 *
 * Hasta ahora el token de refresco se devolvía en la respuesta de login y la interfaz lo
 * guardaba en `localStorage`. Cualquier XSS —una dependencia comprometida, un fragmento de
 * HTML mal escapado— podía leerlo y **mantener la sesión abierta indefinidamente**, incluso
 * después de que la persona cerrara el navegador: es el token de larga vida, no el de quince
 * minutos.
 *
 * En una cookie `HttpOnly` el navegador la envía sola y ningún script puede leerla. El XSS
 * sigue pudiendo hacer peticiones en nombre de la persona mientras la pestaña está abierta,
 * pero ya no puede llevarse la sesión.
 *
 * ## Y por qué eso obliga a proteger contra CSRF
 *
 * Una cookie viaja automáticamente en toda petición al servidor, la haya originado nuestra
 * interfaz o la página de un tercero. Sin protección, un sitio cualquiera podría hacer que el
 * navegador de la víctima llamara a `/auth/refresh` y obtuviera una sesión válida.
 *
 * Se protege en dos capas independientes:
 *
 * 1. **`SameSite=Strict`**: el navegador no adjunta la cookie en peticiones originadas fuera
 *    del propio sitio. Es la defensa principal.
 * 2. **Doble envío**: un valor aleatorio va en una cookie *legible* y debe repetirse en una
 *    cabecera. Un atacante de otro origen puede provocar la petición, pero **no puede leer la
 *    cookie** para componer la cabecera. Cubre lo que `SameSite` no cubre: navegadores
 *    antiguos y subdominios del mismo sitio.
 *
 * El resto de la API no necesita nada de esto: se autentica con `Authorization: Bearer`, que
 * el navegador nunca adjunta solo. Solo las rutas autenticadas POR COOKIE son atacables por
 * esta vía, y son exactamente dos.
 */

/** Cookie del token de refresco. Ningún script puede leerla. */
export const REFRESH_COOKIE = 'bb_refresh';
/** Cookie del testigo CSRF. Legible a propósito: la interfaz debe poder repetirlo. */
export const CSRF_COOKIE = 'bb_csrf';
/** Cabecera donde se repite el testigo. */
export const CSRF_HEADER = 'x-csrf-token';

const CSRF_TOKEN_BYTES = 32;

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax';
  path: string;
  maxAge: number;
}

/**
 * Opciones de las cookies de sesión.
 *
 * `path: '/'` y no `/auth`, aunque restringir el camino sería más estrecho: detrás de un
 * proxy inverso la interfaz llama a `/api/auth/refresh`, y una cookie fijada con `Path=/auth`
 * no se enviaría a esa ruta. La cookie dejaría de llegar y la sesión se caería en cada
 * recarga, en producción y no en desarrollo — el peor tipo de fallo.
 *
 * `secure` solo fuera de desarrollo: en `http://localhost` una cookie `Secure` no se guarda, y
 * la sesión no funcionaría en local. Se decide por entorno, nunca por configuración suelta.
 */
export function sessionCookieOptions(params: {
  isProduction: boolean;
  maxAgeMs: number;
}): { refresh: CookieOptions; csrf: CookieOptions } {
  const base = {
    secure: params.isProduction,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: params.maxAgeMs,
  };

  return {
    refresh: { ...base, httpOnly: true },
    // Legible por la interfaz: es la mitad del doble envío. No es un secreto — su valor está
    // en no ser adivinable ni legible DESDE OTRO ORIGEN, que es cosa de la política de mismo
    // origen del navegador, no de `HttpOnly`.
    csrf: { ...base, httpOnly: false },
  };
}

/**
 * Opciones de la cookie del flujo OAuth. `SameSite=Lax`, y tiene que serlo.
 *
 * El flujo de OAuth vuelve desde OTRO sitio: Google redirige el navegador a nuestro callback
 * con una navegación de nivel superior. Con `SameSite=Strict` el navegador **no adjunta la
 * cookie en esa vuelta**, la verificación del nonce falla siempre y conectar cualquier
 * integración de Google es imposible en un navegador real — aunque los tests HTTP pasen, porque
 * ahí la cookie se pone a mano.
 *
 * `Lax` no debilita la defensa que importa: sigue sin enviarse en peticiones cruzadas que no
 * sean una navegación (`POST`, `fetch`, imágenes), y quien protege este flujo no es `SameSite`
 * sino el par estado-firmado + nonce, que un tercero no puede fabricar. Lo que `Lax` hace es
 * permitir precisamente el único caso legítimo: volver de la pantalla de consentimiento.
 *
 * Vive aparte de `sessionCookieOptions` para que nadie relaje por descuido la del token de
 * refresco, que sí debe seguir siendo `Strict`.
 */
export function oauthFlowCookieOptions(params: {
  isProduction: boolean;
  maxAgeMs: number;
}): CookieOptions {
  return {
    httpOnly: true,
    secure: params.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: params.maxAgeMs,
  };
}

export function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString('hex');
}

/**
 * ¿Coincide el testigo de la cabecera con el de la cookie?
 *
 * Comparación en tiempo constante: una comparación normal se detiene en el primer carácter
 * distinto, y ese tiempo permitiría adivinar el testigo carácter a carácter.
 *
 * Fail-closed ante cualquier ausencia: sin cookie o sin cabecera, no hay coincidencia posible.
 */
export function csrfTokenMatches(
  cookieToken: unknown,
  headerToken: unknown,
): boolean {
  if (
    typeof cookieToken !== 'string' ||
    typeof headerToken !== 'string' ||
    cookieToken.length === 0 ||
    cookieToken.length !== headerToken.length
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(cookieToken, 'utf8'),
    Buffer.from(headerToken, 'utf8'),
  );
}

/**
 * Lee una cookie de la petición.
 *
 * `cookie-parser` deja `req.cookies` como un objeto sin tipar. Leerlo directamente propaga
 * `any` por todo lo que toque, y con ello se pierde justo la comprobación que evita comparar
 * un testigo contra algo que no es texto. Se estrecha aquí, una sola vez.
 */
export function readCookie(
  request: { cookies?: unknown },
  name: string,
): string | undefined {
  const jar = request.cookies;
  if (typeof jar !== 'object' || jar === null) return undefined;

  const value = (jar as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

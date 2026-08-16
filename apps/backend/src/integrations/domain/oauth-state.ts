import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Estado del flujo OAuth: qué se envía a Google y qué se exige al volver.
 *
 * ## Por qué el `state` no basta por sí solo
 *
 * OAuth devuelve a la persona a nuestro servidor con un `code` en la URL. Sin verificación,
 * un tercero puede provocar esa vuelta con un `code` **suyo** y dejar la cuenta de la víctima
 * conectada al Drive del atacante. Es la variante de CSRF propia de OAuth, y su consecuencia
 * aquí es peor que la habitual: todo lo que la empresa ingiera después vendría del Drive de
 * otro, indexado y consultable como conocimiento propio.
 *
 * La defensa es que el `state` esté **atado al navegador que inició el flujo**. Se genera un
 * nonce, se guarda su HASH dentro del `state` firmado y el nonce en claro en una cookie
 * `HttpOnly` — el mismo mecanismo que endureció la sesión. Al volver, ambos deben
 * corresponderse: quien no inició el flujo no tiene la cookie y no puede fabricarla.
 *
 * ## Y por qué el `state` lleva más cosas
 *
 * En el callback ya no hay sesión aplicativa: Google redirige con un GET del navegador, sin
 * cabecera `Authorization`. Quién conecta y para qué organización tiene que viajar dentro del
 * `state` firmado, porque leerlo de un parámetro suelto permitiría conectar el Drive propio a
 * la organización de otro.
 *
 * Dominio puro: sin red, sin base de datos, determinista.
 */

export const OAUTH_NONCE_COOKIE = 'bb_oauth_nonce';
/** Ventana del flujo. Autorizar lleva segundos; diez minutos es holgado y acota el riesgo. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthStatePayload {
  organizationId: string;
  userId: string;
  /** Hash del nonce que va en la cookie. El nonce en claro NUNCA viaja por la URL. */
  nonceHash: string;
  issuedAt: number;
}

export type OAuthStateRejection =
  'MALFORMED' | 'EXPIRED' | 'NONCE_MISMATCH' | 'MISSING_NONCE';

export function generateNonce(): string {
  return randomBytes(32).toString('hex');
}

export function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

export function buildStatePayload(params: {
  organizationId: string;
  userId: string;
  nonce: string;
  now?: number;
}): OAuthStatePayload {
  return {
    organizationId: params.organizationId,
    userId: params.userId,
    nonceHash: hashNonce(params.nonce),
    issuedAt: params.now ?? Date.now(),
  };
}

/**
 * Valida lo que vuelve del callback.
 *
 * Fail-closed en todas las ramas: cualquier cosa que no encaje se rechaza sin conectar nada.
 * Conectar "por si acaso" ataría la organización al Drive equivocado, y eso no se detecta
 * después mirando los datos — todo parecería normal.
 */
export function verifyStatePayload(params: {
  payload: unknown;
  nonceFromCookie: unknown;
  now?: number;
}):
  | { valid: true; organizationId: string; userId: string }
  | { valid: false; reason: OAuthStateRejection } {
  const payload = params.payload;

  if (typeof payload !== 'object' || payload === null) {
    return { valid: false, reason: 'MALFORMED' };
  }

  const { organizationId, userId, nonceHash, issuedAt } =
    payload as Partial<OAuthStatePayload>;

  if (
    typeof organizationId !== 'string' ||
    typeof userId !== 'string' ||
    typeof nonceHash !== 'string' ||
    typeof issuedAt !== 'number' ||
    organizationId.length === 0 ||
    userId.length === 0
  ) {
    return { valid: false, reason: 'MALFORMED' };
  }

  const now = params.now ?? Date.now();
  if (now - issuedAt > OAUTH_STATE_TTL_MS || now < issuedAt) {
    // También se rechaza un `issuedAt` futuro: no puede venir de un flujo nuestro.
    return { valid: false, reason: 'EXPIRED' };
  }

  if (
    typeof params.nonceFromCookie !== 'string' ||
    params.nonceFromCookie.length === 0
  ) {
    // Sin cookie no hay forma de saber que este navegador inició el flujo.
    return { valid: false, reason: 'MISSING_NONCE' };
  }

  if (!hashesMatch(hashNonce(params.nonceFromCookie), nonceHash)) {
    return { valid: false, reason: 'NONCE_MISMATCH' };
  }

  return { valid: true, organizationId, userId };
}

/** Comparación en tiempo constante, igual que con el testigo CSRF. */
function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Los permisos que se piden. Solo LECTURA: BusinessBrain nunca escribe en el Drive. */
export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

/**
 * ¿Concedió Google lo que hacía falta?
 *
 * La pantalla de consentimiento permite conceder menos de lo pedido. Dar la conexión por buena
 * dejaría una fuente que falla en cada sincronización sin que nadie entienda por qué.
 */
export function grantedScopesAreSufficient(granted: string): boolean {
  const scopes = new Set(granted.split(/\s+/).filter(Boolean));
  return DRIVE_SCOPES.every(
    (required) =>
      scopes.has(required) ||
      // `drive` completo incluye la lectura; se acepta aunque nunca se pida.
      scopes.has('https://www.googleapis.com/auth/drive'),
  );
}

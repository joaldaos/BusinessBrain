/**
 * Qué es una acción sensible y qué significa estar "recién autenticado".
 *
 * ## El problema que resuelve
 *
 * Una sesión dura treinta días. Alguien que se deja el portátil abierto, o a quien le roban una
 * sesión, conserva durante ese mes la capacidad de borrar los datos de la empresa entera. El
 * token vivo demuestra que ALGUIEN entró hace semanas; no demuestra que quien está delante
 * ahora sea esa persona.
 *
 * Reautenticarse vuelve a pedir la credencial —el código del móvil, o la contraseña si no hay
 * segundo factor— y abre una ventana corta. Dentro de esa ventana, todas las acciones
 * sensibles pasan sin volver a preguntar: quien está revisando permisos hace tres cosas
 * seguidas, y pedirle el código en cada una convertiría la garantía en un motivo para
 * desactivarla.
 *
 * ## A qué queda atada la ventana
 *
 * A la SESIÓN, no al usuario. Vive en `AuthSession.reauthenticatedAt`. Si viviera en el
 * usuario, reautenticarse en el portátil abriría también la ventana del móvil que alguien
 * dejó abierto en otro sitio — que es exactamente el escenario del que esto protege.
 *
 * ## Un solo nivel de riesgo, dicho a propósito
 *
 * Todas las acciones de la lista de abajo cuestan lo mismo: quince minutos de ventana. Podrían
 * escalonarse —"borrar la empresa exige código aunque acabes de reautenticarte"— y no se hace,
 * porque un sistema de niveles que nadie ha pedido son ramas que nadie prueba. El catálogo es
 * cerrado y cada entrada dice qué se estaba intentando: eso es lo que necesita la traza cuando
 * alguien pregunta qué se denegó.
 */

/** Cuánto dura la ventana. Quince minutos — ver `REAUTH_WINDOW_MS` abajo. */
const MINUTO = 60_000;

/**
 * La ventana de "recién autenticado".
 *
 * Quince minutos, y coincide con la vida del token de acceso a propósito: una ventana más larga
 * sobreviviría a una renovación de credenciales, y "recién autenticado" con un token que ya se
 * renovó por su cuenta es un estado difícil de explicar y más difícil de razonar.
 *
 * Cinco minutos obligarían a repetir a media tarea. Media hora significa que una sesión robada
 * media hora después de una reautenticación legítima pasa igual.
 */
export const REAUTH_WINDOW_MS = 15 * MINUTO;

/**
 * Las acciones que exigen credencial reciente. Catálogo cerrado, como el de auditoría.
 *
 * Cadenas libres acabarían con dos sitios escribiendo `password.change` y `password_change`, y
 * el día que alguien pregunte "qué acciones sensibles se intentaron sin reautenticar" recibiría
 * la mitad.
 */
export const SENSITIVE_ACTIONS = {
  // ── Datos de la empresa entera ────────────────────────────────────────────
  ORGANIZATION_ERASE: 'organization.erase',
  ORGANIZATION_EXPORT: 'organization.export',

  // ── La cuenta ─────────────────────────────────────────────────────────────
  PASSWORD_CHANGE: 'password.change',
  MFA_DISABLE: 'mfa.disable',
  MFA_RECOVERY_CODES_REGENERATE: 'mfa.recovery_codes.regenerate',

  // ── Acceso de la plataforma a los datos de un cliente ─────────────────────
  PLATFORM_ACCESS_APPROVE: 'platform_access.approve',
  PLATFORM_ACCESS_REVOKE: 'platform_access.revoke',
  PLATFORM_ACCESS_REQUEST: 'platform_access.request',

  // ── Sobre la cuenta de otra persona ───────────────────────────────────────
  MFA_REMOVE_FROM_MEMBER: 'mfa.remove_from_member',
  MFA_REMOVE_FROM_PLATFORM: 'mfa.remove_from_platform',

  // ── Administración de plataforma ──────────────────────────────────────────
  USER_BAN: 'user.ban',
  ORGANIZATION_PLAN_CHANGE: 'organization.plan_change',
} as const;

export type SensitiveAction =
  (typeof SENSITIVE_ACTIONS)[keyof typeof SENSITIVE_ACTIONS];

/**
 * ¿Está esta sesión recién autenticada?
 *
 * Dominio puro: una fecha, un reloj y una respuesta. Fail-closed ante la ausencia — una sesión
 * que nunca se reautenticó tiene `null`, y `null` no está dentro de ninguna ventana.
 */
export function isRecentlyAuthenticated(
  reauthenticatedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!reauthenticatedAt) return false;

  const elapsed = now.getTime() - reauthenticatedAt.getTime();
  // El futuro también se rechaza: una fecha posterior a ahora solo puede venir de un reloj
  // desviado o de una escritura corrupta, y ninguna de las dos es motivo para dar permiso.
  return elapsed >= 0 && elapsed < REAUTH_WINDOW_MS;
}

/** Hasta cuándo vale una reautenticación hecha ahora. Lo devuelve la API para la interfaz. */
export function reauthenticatedUntil(from: Date = new Date()): Date {
  return new Date(from.getTime() + REAUTH_WINDOW_MS);
}

/**
 * Lo que se le dice a quien intenta una acción sensible sin ventana abierta.
 *
 * Dice qué falta y qué hacer. No dice qué credencial hace falta —eso lo sabe la interfaz por
 * `GET /auth/me`, y ponerlo en el error de una acción concreta obligaría a mantener el mismo
 * mensaje en once sitios.
 */
export const REAUTH_REQUIRED_MESSAGE =
  'Por seguridad, esta acción necesita que confirmes tu identidad otra vez.';

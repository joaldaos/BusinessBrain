import { MembershipRole, PlatformRole } from '@businessbrain/database';

/**
 * Quién tiene que llevar segundo factor, quién puede retirárselo a quién, y cuántas veces se
 * puede fallar.
 *
 * ## Obligatorio arriba, ofrecido abajo
 *
 * Quien administra BusinessBrain no puede operar sin segundo factor: su cuenta es la que puede
 * pedir acceso a los datos de cualquier cliente, y una cuenta así comprometida no es un
 * incidente de una empresa, son todas. No hay excusa de fricción que valga: son dos personas y
 * lo configuran una vez.
 *
 * El propietario de una PYME es otro caso. Obligarle significaría que el primer día del piloto
 * no puede entrar en su producto hasta instalarse una aplicación en el móvil, con nosotros al
 * teléfono. Se le ofrece, se le explica, y decide él.
 *
 * ## Quién puede retirar un segundo factor
 *
 * Retirar el segundo factor de alguien NO es entrar en su cuenta: después sigue haciendo falta
 * su contraseña. Es degradar su cuenta de dos pruebas a una. Aun así es un poder real, y por eso
 * está acotado a dos figuras y auditado en las dos.
 *
 * El propietario puede hacerlo con los administradores de SU empresa. Ya puede expulsarlos, así
 * que no gana nada que no tuviera; lo que gana es poder desatascar a alguien de su equipo sin
 * llamarnos.
 *
 * Lo que NO puede es hacerlo consigo mismo por esta vía: si pudiera, la sesión abierta de un
 * propietario se convertiría en la forma de quitarse el segundo factor, y el segundo factor
 * dejaría de proteger su propia sesión. Para eso está desactivarlo desde su configuración, que
 * exige reautenticarse.
 */

// ── Obligatoriedad ───────────────────────────────────────────────────────────

/** ¿Esta cuenta no puede operar sin segundo factor? */
export function mfaIsMandatory(platformRole: PlatformRole): boolean {
  return platformRole === PlatformRole.SUPERADMIN;
}

export const MFA_MANDATORY_MESSAGE =
  'Antes de administrar BusinessBrain tienes que activar la verificación en dos pasos en tu configuración.';

// ── Retirada por el propietario de la empresa ────────────────────────────────

export type RemovalDenialReason =
  | 'ACTOR_NOT_OWNER'
  | 'TARGET_NOT_IN_ORGANIZATION'
  | 'TARGET_NOT_ADMIN'
  | 'TARGET_IS_SELF';

export type RemovalDecision =
  { allowed: true } | { allowed: false; reason: RemovalDenialReason };

/**
 * ¿Puede este propietario retirarle el segundo factor a esta persona?
 *
 * Las cuatro condiciones se comprueban por separado para que quien llame pueda registrar POR
 * QUÉ denegó. Una comprobación combinada daría la misma respuesta y dejaría la traza diciendo
 * solo que no.
 */
export function canOwnerRemoveMfa(params: {
  actorRole: MembershipRole;
  actorUserId: string;
  targetUserId: string;
  targetRole: MembershipRole | null;
}): RemovalDecision {
  if (params.actorRole !== MembershipRole.OWNER) {
    return { allowed: false, reason: 'ACTOR_NOT_OWNER' };
  }
  if (params.actorUserId === params.targetUserId) {
    return { allowed: false, reason: 'TARGET_IS_SELF' };
  }
  // Sin membresía en ESTA empresa no hay nada que decidir: la persona no es de aquí.
  if (params.targetRole === null) {
    return { allowed: false, reason: 'TARGET_NOT_IN_ORGANIZATION' };
  }
  if (params.targetRole !== MembershipRole.ADMIN) {
    return { allowed: false, reason: 'TARGET_NOT_ADMIN' };
  }

  return { allowed: true };
}

/**
 * Lo que se le dice a quien no puede.
 *
 * "No pertenece a esta empresa" y "no es administrador" dan el mismo mensaje: quien pregunta
 * por alguien que no es de su empresa no debería poder averiguar, probando identificadores, si
 * esa persona existe en otra.
 */
export const REMOVAL_DENIAL_MESSAGES: Record<RemovalDenialReason, string> = {
  ACTOR_NOT_OWNER:
    'Solo quien es propietario de la empresa puede retirar la verificación en dos pasos de otra persona.',
  TARGET_NOT_IN_ORGANIZATION:
    'Solo puedes hacer esto con los administradores de tu empresa.',
  TARGET_NOT_ADMIN:
    'Solo puedes hacer esto con los administradores de tu empresa.',
  TARGET_IS_SELF:
    'Para quitarte la verificación en dos pasos a ti, hazlo desde tu configuración.',
};

// ── Cuántas veces se puede fallar un código ──────────────────────────────────

/**
 * Intentos antes de bloquear la cuenta un rato.
 *
 * El límite por dirección IP que ya existe no sirve aquí: un código de seis dígitos son un
 * millón de combinaciones, y quien reparte los intentos entre mil direcciones no toca ninguno
 * de esos límites. Contar por CUENTA es lo único que ve un ataque repartido.
 *
 * Cinco intentos, porque teclear mal un código de seis dígitos con prisa pasa dos veces
 * seguidas; cinco no. Y quince minutos de bloqueo: bastante para que un millón de
 * combinaciones tarde siglos, poco para que a quien se equivocó de verdad no le arruine la
 * mañana.
 */
export const MFA_MAX_FAILED_ATTEMPTS = 5;
export const MFA_LOCKOUT_MS = 15 * 60_000;

export interface AttemptState {
  failedAttempts: number;
  lockedUntil: Date | null;
}

export function isLockedOut(
  state: AttemptState,
  now: Date = new Date(),
): boolean {
  return (
    state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime()
  );
}

/** El estado del contador tras un fallo. Al llegar al tope, se bloquea. */
export function afterFailedAttempt(
  state: AttemptState,
  now: Date = new Date(),
): AttemptState {
  const failedAttempts = state.failedAttempts + 1;

  return failedAttempts >= MFA_MAX_FAILED_ATTEMPTS
    ? {
        failedAttempts: 0,
        lockedUntil: new Date(now.getTime() + MFA_LOCKOUT_MS),
      }
    : { failedAttempts, lockedUntil: null };
}

/** Tras un acierto, el contador vuelve a cero. */
export const AFTER_SUCCESSFUL_ATTEMPT: AttemptState = {
  failedAttempts: 0,
  lockedUntil: null,
};

/**
 * El mensaje de un código rechazado. UNO SOLO, y esa es la garantía.
 *
 * Código equivocado, código de recuperación gastado, cuenta bloqueada por intentos: todo dice
 * lo mismo. Distinguirlos le diría a quien está probando cuándo va bien encaminado — y decirle
 * "esta cuenta está bloqueada" ya le confirma que la cuenta existe y tiene segundo factor.
 */
export const MFA_CODE_REJECTED_MESSAGE =
  'El código no es correcto. Comprueba que estás mirando el código actual de tu aplicación e inténtalo otra vez.';

import {
  PlatformAccessScope,
  PlatformAccessStatus,
} from '@businessbrain/database';

/**
 * Cuánto puede ver la administración de BusinessBrain de una empresa, y durante cuánto.
 *
 * ## Los tres alcances son INDEPENDIENTES
 *
 * Ninguno arrastra a otro. Tener `METADATA` no abre `DIAGNOSTICS` ni `CONTENT`, y `CONTENT`
 * tampoco arrastra los otros dos. Una jerarquía habría sido más cómoda —aprobar lo más alto
 * y tenerlo todo— y habría convertido cada aprobación de contenido en una concesión de más
 * cosas de las que el propietario creía estar aprobando.
 *
 * Con alcances independientes, "fuera de alcance deniega" no tiene matices: la concesión sirve
 * para lo que dice y para nada más. El precio es que para ver el panorama y un documento hacen
 * falta dos concesiones, cada una con su motivo y su caducidad. Es el precio correcto.
 *
 * ## Y por qué no hay estado "caducada"
 *
 * La caducidad se deriva del reloj en cada comprobación. Guardarla como estado exigiría un
 * proceso que la actualizara, y entre el momento en que caduca y el momento en que ese proceso
 * pasa habría una ventana con el acceso todavía abierto. Derivarla no tiene ventana: en el
 * instante siguiente al vencimiento, deniega.
 */

const HORA = 60 * 60 * 1000;

export interface ScopePolicy {
  /** Cuánto dura si no se pide otra cosa. */
  defaultHours: number;
  /** El techo. Pedir más no alarga: se recorta. */
  maxHours: number;
  /** Si hace falta que el propietario de la empresa lo apruebe. */
  requiresOwnerApproval: boolean;
}

/**
 * Qué se concede en cada alcance.
 *
 * `CONTENT` dura menos que los otros dos porque es el único que deja leer lo que la empresa
 * escribió. Un acceso a metadatos abierto una semana es una molestia; un acceso al contenido
 * abierto una semana es otra cosa.
 */
export const SCOPE_POLICIES: Record<PlatformAccessScope, ScopePolicy> = {
  [PlatformAccessScope.METADATA]: {
    defaultHours: 24,
    maxHours: 24 * 7,
    requiresOwnerApproval: false,
  },
  [PlatformAccessScope.DIAGNOSTICS]: {
    defaultHours: 24,
    maxHours: 24 * 7,
    requiresOwnerApproval: false,
  },
  [PlatformAccessScope.CONTENT]: {
    defaultHours: 24,
    maxHours: 72,
    requiresOwnerApproval: true,
  },
};

/**
 * Cuánto espera una petición de contenido a que alguien la apruebe.
 *
 * Sin este tope, una petición sin responder quedaría viva indefinidamente y podría aprobarse
 * meses después, cuando el motivo que la justificaba ya no existe. Que caduque sola obliga a
 * volver a pedirla explicando por qué ahora.
 */
export const PENDING_APPROVAL_HOURS = 72;

export function requiresOwnerApproval(scope: PlatformAccessScope): boolean {
  return SCOPE_POLICIES[scope].requiresOwnerApproval;
}

/**
 * Cuándo caduca una concesión de este alcance.
 *
 * Se recorta al techo en vez de rechazar: quien pide siete días de contenido probablemente no
 * sabe que el máximo son tres, y devolverle un error en vez de la concesión más larga posible
 * solo añade una vuelta. Lo que nunca ocurre es que dure más de lo permitido.
 */
export function resolveExpiry(
  scope: PlatformAccessScope,
  requestedHours: number | undefined,
  from: Date = new Date(),
): Date {
  const policy = SCOPE_POLICIES[scope];
  const pedidas =
    typeof requestedHours === 'number' &&
    Number.isFinite(requestedHours) &&
    requestedHours > 0
      ? requestedHours
      : policy.defaultHours;

  return new Date(from.getTime() + Math.min(pedidas, policy.maxHours) * HORA);
}

/** Cuándo caduca una petición que todavía nadie ha aprobado. */
export function pendingApprovalExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + PENDING_APPROVAL_HOURS * HORA);
}

export interface GrantSnapshot {
  scope: PlatformAccessScope;
  status: PlatformAccessStatus;
  requestedById: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type GrantDenialReason =
  | 'NO_GRANT'
  | 'AWAITING_APPROVAL'
  | 'REVOKED'
  | 'EXPIRED'
  | 'OTHER_SCOPE'
  | 'OTHER_ADMIN';

export type GrantDecision =
  { allowed: true } | { allowed: false; reason: GrantDenialReason };

/**
 * ¿Sirve esta concesión, para este alcance, para esta persona, ahora?
 *
 * Dominio puro: mismas entradas, misma decisión, y la decisión explica por qué. Quien llama
 * necesita poder registrar el motivo de la denegación, no solo que denegó.
 *
 * Las cuatro condiciones se comprueban por separado a propósito. Una sola comprobación
 * combinada daría la respuesta correcta y no permitiría distinguir "todavía no la han
 * aprobado" de "ya caducó", que para quien está investigando una incidencia no es lo mismo.
 */
export function evaluateGrant(
  grant: GrantSnapshot | null,
  request: { scope: PlatformAccessScope; adminId: string; now?: Date },
): GrantDecision {
  const now = request.now ?? new Date();

  if (!grant) return deny('NO_GRANT');

  // El alcance no se hereda ni se aproxima: la concesión sirve para el suyo y para ninguno más.
  if (grant.scope !== request.scope) return deny('OTHER_SCOPE');

  // La concesión es de quien la pidió. Otra cuenta de plataforma no la hereda — y eso es lo
  // que impide que una identidad distinta, humana o no, reutilice un acceso ajeno.
  if (grant.requestedById !== request.adminId) return deny('OTHER_ADMIN');

  if (grant.status === PlatformAccessStatus.PENDING) {
    return deny('AWAITING_APPROVAL');
  }
  if (grant.status === PlatformAccessStatus.REVOKED || grant.revokedAt) {
    return deny('REVOKED');
  }
  if (grant.expiresAt.getTime() <= now.getTime()) return deny('EXPIRED');

  return { allowed: true };
}

function deny(reason: GrantDenialReason): GrantDecision {
  return { allowed: false, reason };
}

/**
 * Cómo se le explica la denegación a quien la recibe.
 *
 * Dice qué falta y qué hacer. No dice si existe una concesión de otro alcance ni de otra
 * persona: quien pregunta por un acceso que no tiene no debería poder deducir el mapa de
 * accesos ajenos a base de probar.
 */
export const DENIAL_MESSAGES: Record<GrantDenialReason, string> = {
  NO_GRANT:
    'No hay ningún acceso autorizado para esta empresa y este alcance. Pide uno indicando el motivo.',
  OTHER_SCOPE:
    'No hay ningún acceso autorizado para esta empresa y este alcance. Pide uno indicando el motivo.',
  OTHER_ADMIN:
    'No hay ningún acceso autorizado para esta empresa y este alcance. Pide uno indicando el motivo.',
  AWAITING_APPROVAL:
    'La empresa todavía no ha aprobado este acceso. Sin su aprobación no se puede consultar su contenido.',
  REVOKED:
    'Este acceso se ha retirado. Si sigue haciendo falta, pide uno nuevo.',
  EXPIRED: 'Este acceso ha caducado. Si sigue haciendo falta, pide uno nuevo.',
};

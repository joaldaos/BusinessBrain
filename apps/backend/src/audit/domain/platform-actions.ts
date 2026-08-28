import { AUDIT_ACTIONS, type AuditAction } from './audit-actions';

/**
 * Qué acciones puede consultar quien administra BusinessBrain.
 *
 * ## Por qué es una LISTA CERRADA y no un filtro por prefijo
 *
 * Un `action LIKE 'platform.%'` parece equivalente y no lo es, por dos motivos que ya se
 * cumplen hoy en este repositorio:
 *
 * 1. **Hay acciones administrativas que no llevaban el prefijo.** Banear una cuenta y cambiar
 *    el plan de una empresa se llamaban `user.banned` y `organization.plan_changed`. Un filtro
 *    por prefijo las habría omitido **en silencio**, y una auditoría incompleta que se
 *    presenta como completa es peor que no tener auditoría: quien la lee concluye que no pasó
 *    nada. Se renombraron al espacio de plataforma, pero la lección se queda en el diseño.
 *
 * 2. **Hay acciones de CLIENTE que no cuelgan de ninguna organización.** El borrado de datos
 *    de una empresa se registra con `organizationId: null` a propósito —para sobrevivir a la
 *    cascada— y lo hace el propietario de esa empresa, no la plataforma. Cualquier filtro
 *    basado en "no tiene organización" se lo enseñaría al administrador.
 *
 * La lista cerrada no se equivoca en ninguno de los dos casos: lo que no está explícitamente
 * aquí no se devuelve, aunque se llame `platform.algo`. Falla cerrado, como el resto del
 * sistema.
 *
 * ## Y qué NO entra aquí, nunca
 *
 * La actividad de los clientes. Quién curó una conclusión, quién aceptó una recomendación,
 * quién conectó un Drive: eso es su negocio, y su auditoría es suya. Exponerla aquí
 * convertiría este listado en una vía indirecta de acceso al conocimiento privado de cada
 * empresa — exactamente lo que la separación entre plataforma y cliente existe para impedir.
 */
export const PLATFORM_AUDIT_ACTIONS: readonly AuditAction[] = [
  AUDIT_ACTIONS.PLATFORM_USERS_LISTED,
  AUDIT_ACTIONS.USER_BANNED,
  AUDIT_ACTIONS.USER_UNBANNED,
  AUDIT_ACTIONS.ORGANIZATION_PLAN_CHANGED,
  AUDIT_ACTIONS.PLATFORM_ACCESS_REQUESTED,
  AUDIT_ACTIONS.PLATFORM_ACCESS_APPROVED,
  AUDIT_ACTIONS.PLATFORM_ACCESS_USED,
  AUDIT_ACTIONS.PLATFORM_ACCESS_REVOKED,
  AUDIT_ACTIONS.PLATFORM_MFA_REMOVED,
] as const;

/** El prefijo del espacio de nombres. Se usa para COMPROBAR la lista, no para filtrar. */
export const PLATFORM_ACTION_PREFIX = 'platform.';

export function isPlatformAction(action: string): boolean {
  return (PLATFORM_AUDIT_ACTIONS as readonly string[]).includes(action);
}

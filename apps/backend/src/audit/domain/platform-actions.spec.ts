import { AUDIT_ACTIONS } from './audit-actions';
import {
  PLATFORM_ACTION_PREFIX,
  PLATFORM_AUDIT_ACTIONS,
  isPlatformAction,
} from './platform-actions';

/**
 * La lista de lo que puede ver quien administra BusinessBrain, vigilada en los dos sentidos.
 *
 * Una lista cerrada solo es segura mientras no se desincronice del catálogo. Estas pruebas son
 * las que impiden las dos formas de desincronizarla: olvidarse de añadir una acción
 * administrativa nueva —el administrador vería una auditoría incompleta creyéndola completa—
 * y colar una acción de cliente —el administrador leería la actividad privada de una empresa.
 */
describe('qué auditoría ve la administración de plataforma', () => {
  const todas = Object.values(AUDIT_ACTIONS);

  it('CRÍTICO: toda acción del espacio de plataforma está en la lista', () => {
    // Si alguien añade `platform.algo` y olvida incluirla, esta prueba lo dice. Sin ella, la
    // acción se registraría y nunca se vería: una auditoría con huecos silenciosos.
    const olvidadas = todas.filter(
      (accion) =>
        accion.startsWith(PLATFORM_ACTION_PREFIX) && !isPlatformAction(accion),
    );

    expect(olvidadas).toEqual([]);
  });

  it('CRÍTICO: ninguna acción de CLIENTE está en la lista', () => {
    // La actividad de una empresa —quién curó una conclusión, quién aceptó una recomendación,
    // quién conectó su Drive— es suya. Colarla aquí convertiría este listado en una vía
    // indirecta hacia el conocimiento privado de cada cliente.
    const intrusas = PLATFORM_AUDIT_ACTIONS.filter(
      (accion) => !accion.startsWith(PLATFORM_ACTION_PREFIX),
    );

    expect(intrusas).toEqual([]);
  });

  it('CRÍTICO: el borrado de datos de una empresa NO es una acción de plataforma', () => {
    // Se registra con `organizationId: null` para sobrevivir a la cascada, pero lo hace el
    // PROPIETARIO de esa empresa. Cualquier filtro basado en "no tiene organización" se lo
    // enseñaría al administrador — y por eso el filtro es una lista, no una condición.
    expect(isPlatformAction(AUDIT_ACTIONS.ORGANIZATION_DATA_ERASED)).toBe(
      false,
    );
    expect(isPlatformAction(AUDIT_ACTIONS.ORGANIZATION_DATA_EXPORTED)).toBe(
      false,
    );
  });

  it('las acciones administrativas que existen hoy están todas', () => {
    // La lista literal, a propósito: añadir una acción administrativa obliga a tocar esta
    // prueba, y tocarla obliga a mirar si de verdad debe verla el administrador. Un `expect`
    // que se adaptara solo no protegería de nada.
    expect([...PLATFORM_AUDIT_ACTIONS].sort()).toEqual([
      'platform.access.approved',
      'platform.access.requested',
      'platform.access.revoked',
      'platform.access.used',
      'platform.organization.plan_changed',
      'platform.user.banned',
      'platform.user.unbanned',
      'platform.users.listed',
    ]);
  });

  it('falla cerrado ante lo desconocido', () => {
    // Lo que no está explícitamente en la lista no se devuelve, aunque lo parezca.
    for (const inventada of [
      'platform.inventada',
      'insight.curated',
      '',
      'PLATFORM.USER.BANNED',
    ]) {
      expect(isPlatformAction(inventada)).toBe(false);
    }
  });
});

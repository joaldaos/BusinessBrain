import { describe, expect, it } from 'vitest';
import { hasRole } from './types';

/**
 * La interfaz usa el rol para no ofrecer acciones que la API va a rechazar. **Nunca para
 * autorizar**: quien decide es `OrgRoleGuard`, y una llamada hecha a mano seguiría dando 403.
 *
 * Aun así el orden importa: si aquí se dijera que un MEMBER puede administrar, la interfaz
 * ofrecería botones que fallan, y el usuario aprendería a desconfiar de lo que ve.
 */
describe('hasRole', () => {
  it('respeta el orden de privilegio del backend', () => {
    expect(hasRole('OWNER', 'ADMIN')).toBe(true);
    expect(hasRole('ADMIN', 'ADMIN')).toBe(true);
    expect(hasRole('MEMBER', 'ADMIN')).toBe(false);
    expect(hasRole('VIEWER', 'MEMBER')).toBe(false);
  });

  it('un rol de más cubre siempre a uno de menos', () => {
    expect(hasRole('ADMIN', 'MEMBER')).toBe(true);
    expect(hasRole('MEMBER', 'VIEWER')).toBe(true);
  });

  it('sin rol NO se concede nada', () => {
    // Fail-closed: si todavía no se ha resuelto la membresía, no se ofrece nada.
    expect(hasRole(undefined, 'VIEWER')).toBe(false);
  });
});

import { PlatformRole } from '@businessbrain/database';
import {
  MEMBERSHIP_DENIED_TO_PLATFORM_ADMIN,
  PLATFORM_ROLE_DENIED_TO_MEMBER,
  canBecomePlatformAdmin,
  canHoldMembership,
} from './tenant-separation';

describe('frontera entre plataforma y clientes', () => {
  it('CRÍTICO: una cuenta de plataforma no puede pertenecer a una empresa', () => {
    // Es lo que hace que `OrgRoleGuard` le responda 403 por el camino normal, sin necesitar
    // ninguna excepción que alguien pueda olvidar.
    expect(canHoldMembership(PlatformRole.SUPERADMIN)).toBe(false);
  });

  it('una cuenta normal sí', () => {
    expect(canHoldMembership(PlatformRole.USER)).toBe(true);
  });

  it('CRÍTICO: la frontera se cruza en los dos sentidos', () => {
    // Si solo se comprobara al crear la membresía, bastaría con darle el rol de plataforma a
    // alguien que ya está dentro de una empresa.
    expect(canBecomePlatformAdmin(0)).toBe(true);
    expect(canBecomePlatformAdmin(1)).toBe(false);
    expect(canBecomePlatformAdmin(5)).toBe(false);
  });

  it('los mensajes explican la razón, no la regla', () => {
    // Quien lo lee tiene que entender por qué el producto se niega, no solo que se niega.
    expect(MEMBERSHIP_DENIED_TO_PLATFORM_ADMIN).toMatch(/cuenta distinta/i);
    expect(PLATFORM_ROLE_DENIED_TO_MEMBER).toMatch(/pertenece/i);

    // Y no nombran clases, roles internos ni columnas.
    for (const mensaje of [
      MEMBERSHIP_DENIED_TO_PLATFORM_ADMIN,
      PLATFORM_ROLE_DENIED_TO_MEMBER,
    ]) {
      expect(mensaje).not.toMatch(/SUPERADMIN|Membership|platformRole|Guard/);
    }
  });
});

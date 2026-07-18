import { SetMetadata } from '@nestjs/common';
import type { MembershipRole } from '@businessbrain/database';

export const ORG_ROLES_KEY = 'orgRoles';

/**
 * Restringe un endpoint a roles de membresía de organización concretos,
 * evaluado por OrgRoleGuard. Sin este decorador, OrgRoleGuard solo exige
 * que exista membresía (cualquier rol) en la organización resuelta.
 *
 * No existe un @PlatformRoles equivalente: PlatformRole solo tiene dos valores
 * (USER/SUPERADMIN), así que SuperAdminGuard comprueba SUPERADMIN directamente
 * en vez de añadir una capa de metadata para una decisión binaria.
 */
export const OrgRoles = (...roles: MembershipRole[]) =>
  SetMetadata(ORG_ROLES_KEY, roles);

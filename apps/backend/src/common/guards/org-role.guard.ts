import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipRole } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { ORG_ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/** Jerarquía usada solo para decidir si un rol "cumple" el mínimo exigido por @OrgRoles(...). */
const ROLE_RANK: Record<MembershipRole, number> = {
  [MembershipRole.VIEWER]: 0,
  [MembershipRole.MEMBER]: 1,
  [MembershipRole.ADMIN]: 2,
  [MembershipRole.OWNER]: 3,
};

/**
 * Resuelve la organización activa a partir de la ruta (:id o :organizationId) o del
 * header `x-org-id`, comprueba que el usuario autenticado tiene membresía en ella,
 * adjunta { id, slug, role } a req.organization y, si el endpoint declara @OrgRoles(...),
 * exige que el rol de membresía cumpla el mínimo indicado.
 *
 * Debe aplicarse DESPUÉS de JwtAuthGuard (necesita req.user ya resuelto).
 */
@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const organizationId = this.extractOrganizationId(request);

    if (!organizationId) {
      throw new NotFoundException(
        'No se pudo resolver la organización de la petición',
      );
    }

    const membership = request.user.memberships.find(
      (m) => m.organizationId === organizationId,
    );
    if (!membership) {
      throw new ForbiddenException('No perteneces a esta organización');
    }

    const requiredRoles = this.reflector.getAllAndOverride<MembershipRole[]>(
      ORG_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredRoles?.length) {
      const minRequiredRank = Math.min(
        ...requiredRoles.map((r) => ROLE_RANK[r]),
      );
      if (ROLE_RANK[membership.role] < minRequiredRank) {
        throw new ForbiddenException(
          `Rol insuficiente en la organización (tienes ${membership.role})`,
        );
      }
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, slug: true },
    });
    if (!organization) {
      throw new NotFoundException('Organización no encontrada');
    }

    request.organization = {
      id: organization.id,
      slug: organization.slug,
      role: membership.role,
    };
    return true;
  }

  /**
   * express tipa req.params como Record<string, string | string[]> (soporta rutas con
   * parámetros repetidos, p. ej. `/:id/:id`) — aquí solo nos interesa el caso simple,
   * así que se descarta explícitamente cualquier valor que no sea un string plano.
   */
  private extractOrganizationId(
    request: AuthenticatedRequest,
  ): string | undefined {
    const fromParams = request.params.organizationId ?? request.params.id;
    if (typeof fromParams === 'string') return fromParams;

    const fromHeader = request.headers['x-org-id'];
    return typeof fromHeader === 'string' ? fromHeader : undefined;
  }
}

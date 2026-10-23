import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipPermissionsService } from '../security/membership-permissions.service';
import {
  REQUIRED_PERMISSION_KEY,
  type RequiredPermission,
} from '../decorators/require-permission.decorator';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * Exige un permiso concreto sobre un módulo.
 *
 * Va DESPUÉS de `OrgRoleGuard`, que es quien resuelve la organización activa y comprueba la
 * membresía. Aquí solo se decide si esa persona puede hacer ESTO.
 *
 * ## Por qué convive con `@OrgRoles(...)` en vez de sustituirlo
 *
 * Porque hay cosas que no son un permiso de módulo sino una propiedad de la persona: cambiar
 * el rol de otro, o desactivar la verificación en dos pasos de la empresa, son del
 * propietario y de nadie más. Eso se expresa mejor con un rol que con un permiso, y
 * convertirlo en permiso solo añadiría una forma de concederlo por error.
 *
 * Una ruta puede declarar los dos. Se aplican ambos, y el más estricto gana — que es lo que
 * se espera de dos puertas seguidas.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: MembershipPermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredPermission>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    // Sin declaración, este guard no opina. Lo que decide entonces es `@OrgRoles`.
    if (!required) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const organization = request.organization;

    if (!organization) {
      // Llegar aquí significa que la ruta declaró un permiso sin pasar por `OrgRoleGuard`.
      // Es un error de programación, y se dice en vez de dejar pasar.
      throw new ForbiddenException(
        'No se pudo resolver la organización para comprobar permisos',
      );
    }

    const membership = request.user.memberships.find(
      (m) => m.organizationId === organization.id,
    );
    if (!membership) {
      throw new ForbiddenException('No perteneces a esta organización');
    }

    const permitido = await this.permissions.can(
      {
        userId: request.user.id,
        organizationId: organization.id,
        role: membership.role,
        membershipId: membership.id,
      },
      required.module,
      required.action,
    );

    if (!permitido) {
      /*
       * El mensaje dice QUÉ falta, no quién lo tiene ni cómo conseguirlo.
       *
       * Es útil para quien se lo encuentra —puede pedírselo a su responsable— y no revela
       * nada sobre la configuración de permisos de la empresa.
       */
      throw new ForbiddenException(
        `No tienes permiso para esta acción (${required.module}:${required.action}). ` +
          `Pídeselo a quien administre tu empresa.`,
      );
    }

    return true;
  }
}

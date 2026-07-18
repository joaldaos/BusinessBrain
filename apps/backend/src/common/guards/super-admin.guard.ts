import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { PlatformRole } from '@businessbrain/database';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * Restringe un endpoint al rol de plataforma SUPERADMIN (evolución de requireAdmin
 * de Drop, ahora explícitamente separado del rol de organización — ver
 * docs/BUSINESSBRAIN_MIGRATION_PLAN.md §3, fila "Autorización").
 * Debe aplicarse DESPUÉS de JwtAuthGuard.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user.platformRole !== PlatformRole.SUPERADMIN) {
      throw new ForbiddenException('Requiere rol de superadmin de plataforma');
    }
    return true;
  }
}

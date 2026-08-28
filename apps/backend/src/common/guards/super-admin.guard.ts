import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { PlatformRole } from '@businessbrain/database';
import {
  MFA_MANDATORY_MESSAGE,
  mfaIsMandatory,
} from '../../auth/domain/mfa-policy';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * Restringe un endpoint al rol de plataforma SUPERADMIN (evolución de requireAdmin
 * de Drop, ahora explícitamente separado del rol de organización — ver
 * docs/BUSINESSBRAIN_MIGRATION_PLAN.md §3, fila "Autorización").
 * Debe aplicarse DESPUÉS de JwtAuthGuard.
 *
 * ## Sin verificación en dos pasos no se administra nada
 *
 * Una cuenta de plataforma comprometida no es un incidente de una empresa: es la que puede
 * pedir acceso a los datos de todas. Por eso el segundo factor es obligatorio aquí y opcional
 * para los clientes, y por eso se comprueba en la PUERTA en lugar de en cada ruta: exigirlo
 * ruta a ruta significa que la próxima que alguien añada nacerá sin él.
 *
 * Lo que sigue funcionando sin segundo factor es entrar y llegar a la configuración de la
 * propia cuenta — que están fuera de `/admin` y no pasan por aquí. Si no fuera así, un
 * administrador nuevo no tendría por dónde activarlo y el requisito sería imposible de
 * cumplir.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (user.platformRole !== PlatformRole.SUPERADMIN) {
      throw new ForbiddenException('Requiere rol de superadmin de plataforma');
    }

    if (mfaIsMandatory(user.platformRole) && !user.mfaEnabled) {
      throw new ForbiddenException(MFA_MANDATORY_MESSAGE);
    }

    return true;
  }
}

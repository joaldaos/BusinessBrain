import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../../audit/audit.service';
import { AUDIT_ACTIONS } from '../../audit/domain/audit-actions';
import { RECENT_AUTH_KEY } from '../decorators/requires-recent-auth.decorator';
import {
  REAUTH_REQUIRED_MESSAGE,
  isRecentlyAuthenticated,
  type SensitiveAction,
} from '../security/sensitive-actions';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * Exige que ESTA sesión haya demostrado la identidad hace poco.
 *
 * ## Lo que comprueba y lo que no
 *
 * No comprueba que el token esté vivo —de eso ya se encargó `JwtAuthGuard`— sino que quien está
 * al otro lado lo ha demostrado en los últimos quince minutos. Son cosas distintas: un token
 * vivo prueba que alguien entró, quizá hace tres semanas.
 *
 * La marca vive en la SESIÓN, así que reautenticarse en un sitio no abre la ventana en otro. Un
 * portátil abierto en una oficina no hereda lo que se hizo desde casa.
 *
 * ## Fail-closed, sin excepciones de rol
 *
 * No hay atajo para administradores de plataforma ni para propietarios. Un guard con una
 * excepción "para el caso raro" es un guard que en el caso raro no existe, y el caso raro
 * siempre acaba siendo el importante.
 *
 * ## Por qué se audita la DENEGACIÓN
 *
 * Un intento de borrar los datos de una empresa desde una sesión que no puede demostrar quién
 * es no es un error del usuario: es exactamente la señal que alguien querría ver después. Si
 * solo se registrara lo que sale bien, la traza contaría los accesos legítimos y ninguno de
 * los otros.
 */
@Injectable()
export class RecentAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<SensitiveAction>(
      RECENT_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );
    // Sin acción declarada no hay nada que exigir. Ocurre si alguien pone el guard sin el
    // decorador; dejar pasar es correcto porque el decorador es quien declara la sensibilidad.
    if (!action) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (isRecentlyAuthenticated(user.reauthenticatedAt)) return true;

    await this.audit.record({
      // Sin organización: es un hecho sobre una SESIÓN, no sobre una empresa. La ruta sí queda,
      // porque es lo que dice qué se intentaba.
      organizationId: null,
      actorId: user.id,
      action: AUDIT_ACTIONS.SENSITIVE_ACTION_DENIED,
      metadata: {
        sensitiveAction: action,
        // Nunca el token ni la sesión completa: solo si la sesión llegó a reautenticarse
        // alguna vez, que es lo que distingue "caducó" de "nunca lo hizo".
        hadPreviousReauthentication: user.reauthenticatedAt !== null,
      },
    });

    throw new ForbiddenException(REAUTH_REQUIRED_MESSAGE);
  }
}

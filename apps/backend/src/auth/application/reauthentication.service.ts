import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import { reauthenticatedUntil } from '../../common/security/sensitive-actions';
import { AuthService, BCRYPT_ROUNDS } from '../auth.service';
import { MfaService } from './mfa.service';
import type { RequestUser } from '../../common/types/authenticated-request';

/**
 * Volver a demostrar quién eres, y cambiar la contraseña.
 *
 * ## Qué credencial se pide, y por qué no las dos indistintamente
 *
 * Si la cuenta tiene segundo factor, se pide el código. **La contraseña no vale**, y eso es
 * deliberado: el escenario del que esto protege es una sesión en manos de otro, y en ese
 * escenario la contraseña suele estar en el gestor del navegador, rellenada automáticamente
 * por la misma página comprometida. El código de seis dígitos está en otro dispositivo.
 *
 * Aceptar cualquiera de las dos sería más cómodo y convertiría el segundo factor en opcional
 * justo en las acciones para las que existe.
 *
 * Sin segundo factor se pide la contraseña, que es la única credencial que hay. Es menos
 * garantía, y por eso el producto ofrece activar la verificación en dos pasos.
 *
 * ## La ventana se abre en LA SESIÓN
 *
 * `AuthSession.reauthenticatedAt`. No en la persona: reautenticarse en el portátil no puede
 * abrir la ventana del móvil que alguien dejó abierto en otro sitio.
 */
@Injectable()
export class ReauthenticationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Abre la ventana de quince minutos para esta sesión.
   *
   * Falla cerrado: sin la credencial que corresponde, no se toca la sesión. No hay camino en el
   * que un código equivocado deje la ventana como estaba y devuelva algo parecido a un éxito.
   */
  async reauthenticate(
    user: RequestUser,
    credentials: { password?: string; code?: string },
  ): Promise<{ reauthenticatedUntil: Date }> {
    const method = user.mfaEnabled ? 'totp' : 'password';

    if (method === 'totp') {
      if (!credentials.code) {
        throw new BadRequestException(
          'Introduce el código de tu aplicación de verificación.',
        );
      }
      // Lanza si no es válido. Un código incorrecto NO cae hacia la contraseña: sería el
      // fallback silencioso que convierte el segundo factor en decorado.
      await this.mfa.verifyCode(user.id, credentials.code);
    } else {
      if (!credentials.password) {
        throw new BadRequestException('Introduce tu contraseña.');
      }
      const matches = await this.auth.passwordMatches(
        user.id,
        credentials.password,
      );
      if (!matches) {
        throw new UnauthorizedException('La contraseña no es correcta.');
      }
    }

    const now = new Date();
    await this.prisma.authSession.update({
      where: { id: user.sessionId },
      data: { reauthenticatedAt: now },
    });

    await this.audit.record({
      organizationId: null,
      actorId: user.id,
      action: AUDIT_ACTIONS.REAUTHENTICATED,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: user.id,
      // Con qué se demostró, nunca el qué. Ni la contraseña ni el código entran aquí.
      metadata: { method },
    });

    return { reauthenticatedUntil: reauthenticatedUntil(now) };
  }

  /**
   * Cambiar la contraseña desde dentro.
   *
   * La ruta ya exige reautenticación reciente, así que la identidad está demostrada con la
   * credencial más fuerte que tenga la cuenta. Pedir además la contraseña actual aquí sería
   * redundante cuando hay segundo factor —el código demuestra más— y para quien no lo tiene ya
   * fue la contraseña actual lo que abrió la ventana.
   *
   * ## Qué sesiones caen
   *
   * Todas menos esta. Alguien cambia la contraseña justamente cuando sospecha que otro entró:
   * si las demás sobrevivieran, el intruso seguiría dentro y el cambio no habría servido de
   * nada. La actual se conserva porque cerrarle la sesión a quien acaba de demostrar quién es,
   * en la pantalla en la que está, sería castigar la acción correcta.
   *
   * ## Y el segundo factor NO se toca
   *
   * Cambiar la contraseña no desactiva la verificación en dos pasos, aquí ni en el flujo por
   * correo. Si la desactivara, quien controlara el buzón se saltaría el segundo factor entero.
   */
  async changePassword(
    user: RequestUser,
    newPassword: string,
  ): Promise<{ success: true }> {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await this.auth.revokeSessions({
      userId: user.id,
      except: user.sessionId,
    });

    await this.audit.record({
      organizationId: null,
      actorId: user.id,
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: user.id,
      // Ni la contraseña vieja ni la nueva ni sus hashes. Que ocurrió y desde dónde.
      metadata: { otherSessionsRevoked: true },
    });

    return { success: true };
  }
}

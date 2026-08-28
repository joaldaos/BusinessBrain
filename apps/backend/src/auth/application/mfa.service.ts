import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/utils/encryption.util';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import {
  AFTER_SUCCESSFUL_ATTEMPT,
  MFA_CODE_REJECTED_MESSAGE,
  afterFailedAttempt,
  isLockedOut,
} from '../domain/mfa-policy';
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  hashRecoveryCode,
} from '../domain/recovery-codes';
import {
  formatSecretForManualEntry,
  generateTotpSecret,
  otpauthUrl,
  verifyTotp,
} from '../domain/totp';
import type { AppConfig } from '../../config/configuration';

/**
 * La verificación en dos pasos: darla de alta, comprobarla, quitarla.
 *
 * ## El secreto se cifra, no se hashea
 *
 * Es la diferencia con todo lo demás que se guarda aquí. Una contraseña solo hay que
 * comprobarla, así que basta con su hash; un secreto TOTP hay que RECALCULARLO cada treinta
 * segundos para saber qué código toca, y eso exige el secreto original. Se usa el
 * `EncryptionService` que ya cifra las claves de los proveedores de IA — mismo AES-256-GCM,
 * misma `ENCRYPTION_KEY`, ninguna criptografía nueva que revisar.
 *
 * ## El alta tiene dos pasos y no uno
 *
 * Pedir el QR guarda el secreto pero NO activa nada. La verificación se activa cuando llega el
 * primer código correcto, porque es la única prueba de que la aplicación quedó bien
 * configurada. Si se activara al generar el QR, alguien que cierra la pestaña a medias se
 * queda fuera de su cuenta para siempre — con un segundo factor que nunca llegó a tener.
 *
 * Por eso lo que activa es la FECHA (`mfaEnabledAt`) y no la presencia del secreto.
 *
 * ## Los códigos rechazados no explican por qué
 *
 * Código equivocado, código de papel ya gastado, cuenta bloqueada por intentos: un solo
 * mensaje. Decir "esta cuenta está bloqueada" ya confirma que la cuenta existe y tiene segundo
 * factor, y decir "ese código ya se usó" le dice a quien prueba que iba bien encaminado.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Primer paso del alta: un secreto nuevo y el QR para escanearlo.
   *
   * Repetirlo antes de confirmar genera OTRO secreto y descarta el anterior. Es lo correcto:
   * quien vuelve a esta pantalla es porque la primera vez no le funcionó, y dejarle el secreto
   * viejo sería darle el mismo problema otra vez.
   *
   * No se puede llamar con la verificación ya activa. Regenerar el secreto de una cuenta que ya
   * lo tiene funcionando la dejaría con una aplicación que muestra códigos que ya no valen.
   */
  async beginEnrollment(userId: string): Promise<{
    qrDataUrl: string;
    manualKey: string;
  }> {
    const user = await this.requireUser(userId);
    if (user.mfaEnabledAt) {
      throw new BadRequestException(
        'Ya tienes la verificación en dos pasos activada.',
      );
    }

    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecretEnc: this.encryption.encrypt(secret) },
    });

    const url = otpauthUrl({ secret, account: user.email });

    return {
      qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 240 }),
      // Para quien no puede escanear: cámara rota, ordenador sin móvil delante, lector que no
      // enfoca. Es la salida secundaria, no la principal.
      manualKey: formatSecretForManualEntry(secret),
    };
  }

  /**
   * Segundo paso: el primer código correcto activa la verificación y entrega los códigos de
   * papel.
   *
   * Es la ÚNICA vez que los códigos de recuperación existen en claro. No hay ninguna ruta que
   * los devuelva después, y no puede haberla: de ellos solo queda su HMAC.
   */
  async confirmEnrollment(
    userId: string,
    code: string,
  ): Promise<{ recoveryCodes: readonly string[] }> {
    const user = await this.requireUser(userId);
    if (user.mfaEnabledAt) {
      throw new BadRequestException(
        'Ya tienes la verificación en dos pasos activada.',
      );
    }
    if (!user.mfaSecretEnc) {
      throw new BadRequestException(
        'Todavía no has empezado a configurar la verificación en dos pasos.',
      );
    }

    if (!verifyTotp(this.encryption.decrypt(user.mfaSecretEnc), code)) {
      await this.recordFailure(userId, 'enrollment');
      throw new BadRequestException(MFA_CODE_REJECTED_MESSAGE);
    }

    const codes = generateRecoveryCodes();

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          mfaEnabledAt: new Date(),
          mfaFailedAttempts: 0,
          mfaLockedUntil: null,
        },
      }),
      // Un alta anterior abandonada podría haber dejado códigos sueltos.
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: codes.map((plain) => ({
          userId,
          codeHash: this.hashCode(plain),
        })),
      }),
    ]);

    await this.audit.record({
      organizationId: null,
      actorId: userId,
      action: AUDIT_ACTIONS.MFA_ENABLED,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: userId,
      // Cuántos códigos quedan, no cuáles. La cifra sirve para responder "¿le quedaban?"; los
      // códigos no pueden entrar aquí ni redactados.
      metadata: { recoveryCodesIssued: RECOVERY_CODE_COUNT },
    });

    return { recoveryCodes: codes };
  }

  /**
   * Comprueba un código: el de la aplicación o uno de papel.
   *
   * Sirve para entrar y para reautenticarse. Devuelve CÓMO se resolvió, porque quien llama
   * necesita poder registrar que se gastó un código de papel — que es una señal distinta de un
   * inicio de sesión normal.
   *
   * El contador de intentos es por CUENTA, no por dirección: el límite por IP que ya existe no
   * ve un ataque repartido entre mil direcciones, que es exactamente como se ataca un número de
   * seis dígitos.
   */
  async verifyCode(
    userId: string,
    code: string,
  ): Promise<{ method: 'totp' | 'recovery-code'; remainingCodes?: number }> {
    const user = await this.requireUser(userId);
    if (!user.mfaEnabledAt || !user.mfaSecretEnc) {
      // No debería llegarse aquí: quien llama comprueba antes si hay segundo factor. Si
      // llega, se deniega — nunca se deja pasar por no haber nada que comprobar.
      throw new UnauthorizedException(MFA_CODE_REJECTED_MESSAGE);
    }

    if (
      isLockedOut({
        failedAttempts: user.mfaFailedAttempts,
        lockedUntil: user.mfaLockedUntil,
      })
    ) {
      // Mismo mensaje que un código equivocado: decir "estás bloqueado" confirmaría que la
      // cuenta existe y que tiene segundo factor.
      throw new UnauthorizedException(MFA_CODE_REJECTED_MESSAGE);
    }

    if (verifyTotp(this.encryption.decrypt(user.mfaSecretEnc), code)) {
      await this.resetAttempts(userId);
      await this.audit.record({
        organizationId: null,
        actorId: userId,
        action: AUDIT_ACTIONS.MFA_CODE_VERIFIED,
        targetType: AUDIT_TARGET_TYPES.USER,
        targetId: userId,
        metadata: { method: 'totp' },
      });
      return { method: 'totp' };
    }

    const consumed = await this.consumeRecoveryCode(userId, code);
    if (consumed !== null) {
      await this.resetAttempts(userId);
      await this.audit.record({
        organizationId: null,
        actorId: userId,
        action: AUDIT_ACTIONS.MFA_RECOVERY_CODE_USED,
        targetType: AUDIT_TARGET_TYPES.USER,
        targetId: userId,
        // Cuántos quedan. Nunca cuál se usó: sería la mitad de una credencial en un almacén
        // que no rota.
        metadata: { remainingCodes: consumed },
      });
      return { method: 'recovery-code', remainingCodes: consumed };
    }

    await this.recordFailure(userId, 'verification');
    throw new UnauthorizedException(MFA_CODE_REJECTED_MESSAGE);
  }

  /**
   * Gasta un código de papel, si el que llega es uno.
   *
   * Transición CONDICIONAL —`usedAt: null` en el `where`— y no lectura seguida de escritura.
   * Dos peticiones simultáneas con el mismo código: solo una encuentra la fila sin usar. Con
   * comprobar y luego escribir, las dos pasarían, y "de un solo uso" sería mentira justo bajo
   * la condición en que importa.
   *
   * Acotado por `userId`: el código de una persona no vale para otra aunque coincidiera.
   */
  private async consumeRecoveryCode(
    userId: string,
    code: string,
  ): Promise<number | null> {
    const candidate = await this.prisma.mfaRecoveryCode.findFirst({
      where: { userId, codeHash: this.hashCode(code), usedAt: null },
      select: { id: true },
    });
    if (!candidate) return null;

    const marked = await this.prisma.mfaRecoveryCode.updateMany({
      where: { id: candidate.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (marked.count === 0) return null;

    return this.prisma.mfaRecoveryCode.count({
      where: { userId, usedAt: null },
    });
  }

  /**
   * Quitarse la verificación en dos pasos.
   *
   * La ruta exige reautenticación reciente, así que aquí ya se demostró la identidad. Se borran
   * secreto, fecha y códigos: no queda nada de un segundo factor a medias que confunda después.
   */
  async disable(userId: string): Promise<{ mfaEnabled: false }> {
    await this.clearMfa(userId);

    await this.audit.record({
      organizationId: null,
      actorId: userId,
      action: AUDIT_ACTIONS.MFA_DISABLED,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: userId,
    });

    return { mfaEnabled: false };
  }

  /**
   * Diez códigos nuevos; los anteriores dejan de valer.
   *
   * Se regeneran cuando quedan pocos o cuando no se sabe dónde acabó el papel. Que los viejos
   * mueran es el punto: si sobrevivieran, regenerar por sospecha no serviría de nada.
   */
  async regenerateRecoveryCodes(
    userId: string,
  ): Promise<{ recoveryCodes: readonly string[] }> {
    const user = await this.requireUser(userId);
    if (!user.mfaEnabledAt) {
      throw new BadRequestException(
        'No tienes la verificación en dos pasos activada.',
      );
    }

    const codes = generateRecoveryCodes();

    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: codes.map((plain) => ({
          userId,
          codeHash: this.hashCode(plain),
        })),
      }),
    ]);

    await this.audit.record({
      organizationId: null,
      actorId: userId,
      action: AUDIT_ACTIONS.MFA_RECOVERY_CODES_REGENERATED,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: userId,
      metadata: { recoveryCodesIssued: RECOVERY_CODE_COUNT },
    });

    return { recoveryCodes: codes };
  }

  /**
   * Retira el segundo factor de una cuenta ajena.
   *
   * Lo usan el propietario de una empresa y la administración de plataforma; cada uno con su
   * ruta, sus condiciones y su entrada de auditoría, que escribe quien llama. Aquí solo se
   * borra, y se borra igual en los dos casos.
   *
   * **Esto no da acceso a nada.** Después sigue haciendo falta la contraseña de esa persona.
   * Retirar el segundo factor es degradar una cuenta de dos pruebas a una, no entrar en ella:
   * no se emite ninguna sesión, no se toca la contraseña y no se devuelve ningún token.
   */
  async removeFrom(userId: string): Promise<void> {
    await this.clearMfa(userId);
  }

  private async clearMfa(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          mfaSecretEnc: null,
          mfaEnabledAt: null,
          mfaFailedAttempts: 0,
          mfaLockedUntil: null,
        },
      }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    ]);
  }

  /** El estado que ve la persona en su configuración. Nunca el secreto ni los códigos. */
  async statusFor(userId: string): Promise<{
    enabled: boolean;
    enabledAt: Date | null;
    pendingConfirmation: boolean;
    remainingRecoveryCodes: number;
  }> {
    const user = await this.requireUser(userId);
    const remaining = user.mfaEnabledAt
      ? await this.prisma.mfaRecoveryCode.count({
          where: { userId, usedAt: null },
        })
      : 0;

    return {
      enabled: user.mfaEnabledAt !== null,
      enabledAt: user.mfaEnabledAt,
      // Secreto guardado pero sin confirmar: el alta se quedó a medias y hay que terminarla.
      pendingConfirmation:
        user.mfaEnabledAt === null && user.mfaSecretEnc !== null,
      remainingRecoveryCodes: remaining,
    };
  }

  private async recordFailure(
    userId: string,
    stage: 'enrollment' | 'verification',
  ): Promise<void> {
    const user = await this.requireUser(userId);
    const next = afterFailedAttempt({
      failedAttempts: user.mfaFailedAttempts,
      lockedUntil: user.mfaLockedUntil,
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaFailedAttempts: next.failedAttempts,
        mfaLockedUntil: next.lockedUntil,
      },
    });

    await this.audit.record({
      organizationId: null,
      actorId: userId,
      action: AUDIT_ACTIONS.MFA_CODE_FAILED,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: userId,
      // Ni el código que se probó ni nada de lo que se dedujera. Solo que falló, dónde, y si
      // eso ha dejado la cuenta bloqueada — que es la señal que alguien querría ver repetida.
      metadata: { stage, lockedOut: next.lockedUntil !== null },
    });
  }

  private async resetAttempts(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaFailedAttempts: AFTER_SUCCESSFUL_ATTEMPT.failedAttempts,
        mfaLockedUntil: AFTER_SUCCESSFUL_ATTEMPT.lockedUntil,
      },
    });
  }

  private hashCode(code: string): string {
    return hashRecoveryCode(
      code,
      this.configService.get('jwt.refreshSecret', { infer: true }),
    );
  }

  private async requireUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        mfaSecretEnc: true,
        mfaEnabledAt: true,
        mfaFailedAttempts: true,
        mfaLockedUntil: true,
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }
}

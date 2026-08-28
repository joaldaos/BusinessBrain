import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MembershipRole } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import { MAILER, type MailerPort } from '../../mail/domain/mailer.port';
import {
  REMOVAL_DENIAL_MESSAGES,
  canOwnerRemoveMfa,
} from '../domain/mfa-policy';
import {
  mfaRemovedByOwnerEmail,
  mfaRemovedByPlatformEmail,
  mfaRemovedByPlatformOwnerNoticeEmail,
} from '../domain/mfa-notices';
import { MfaService } from './mfa.service';

/**
 * Retirar el segundo factor de la cuenta de OTRA persona.
 *
 * ## Lo que esto es, y lo que categóricamente no es
 *
 * Es degradar una cuenta de dos pruebas a una. Después de esto, quien quiera entrar en esa
 * cuenta sigue necesitando su contraseña, que aquí ni se lee ni se cambia ni se puede fijar.
 *
 * **No se emite ninguna sesión, no se devuelve ningún token, no se accede a ningún documento.**
 * Es la línea que separa "puedo desatascar a alguien que ha perdido el móvil" de "puedo entrar
 * en su cuenta", y no es una convención: no existe el código que lo haga. Ninguno de los dos
 * métodos de esta clase devuelve credenciales de nada.
 *
 * ## Dos figuras, dos condiciones distintas
 *
 * El **propietario** puede hacerlo con los administradores de su empresa. Ya puede expulsarlos,
 * así que no gana ningún poder que no tuviera; lo que gana es resolver el caso normal sin
 * llamarnos. No consigo mismo: si pudiera, su propia sesión abierta sería la forma de quitarse
 * el segundo factor, y el segundo factor dejaría de proteger la sesión desde la que se usa.
 *
 * La **plataforma** puede hacerlo como último recurso, con motivo obligatorio, y avisando por
 * correo a la persona afectada y al propietario de su empresa. Es el único caso que cubre al
 * propietario que ha perdido a la vez el móvil y los códigos de papel.
 */
@Injectable()
export class MfaAdministrationService {
  private readonly logger = new Logger(MfaAdministrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
    @Inject(MAILER) private readonly mailer: MailerPort,
  ) {}

  /**
   * El propietario retira el segundo factor de un administrador de SU empresa.
   *
   * Las condiciones las decide el dominio (`canOwnerRemoveMfa`), que devuelve el motivo exacto
   * de la denegación para poder registrarlo. Los mensajes de "no está en tu empresa" y "no es
   * administrador" son idénticos: quien pregunta por alguien que no es de su empresa no debería
   * poder averiguar, probando identificadores, si esa persona existe en otra.
   */
  async removeByOwner(params: {
    organizationId: string;
    ownerUserId: string;
    ownerRole: MembershipRole;
    targetUserId: string;
  }): Promise<{ success: true }> {
    const [organization, target] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: params.organizationId },
        select: { id: true, name: true },
      }),
      this.prisma.user.findUnique({
        where: { id: params.targetUserId },
        select: {
          id: true,
          name: true,
          email: true,
          mfaEnabledAt: true,
          memberships: {
            where: { organizationId: params.organizationId },
            select: { role: true },
          },
        },
      }),
    ]);

    if (!organization)
      throw new NotFoundException('Organización no encontrada');

    const decision = canOwnerRemoveMfa({
      actorRole: params.ownerRole,
      actorUserId: params.ownerUserId,
      targetUserId: params.targetUserId,
      // Sin usuario, se decide igual que "no está en esta empresa": la misma respuesta para
      // un identificador inventado que para uno de otra empresa.
      targetRole: target?.memberships[0]?.role ?? null,
    });
    if (!decision.allowed) {
      throw new ForbiddenException(REMOVAL_DENIAL_MESSAGES[decision.reason]);
    }
    if (!target) throw new NotFoundException('Usuario no encontrado');

    if (!target.mfaEnabledAt) {
      throw new BadRequestException(
        'Esa persona no tiene la verificación en dos pasos activada.',
      );
    }

    const owner = await this.prisma.user.findUniqueOrThrow({
      where: { id: params.ownerUserId },
      select: { name: true },
    });

    await this.mfa.removeFrom(target.id);

    await this.audit.record({
      // Acción de TENANT: la decide quien responde por esa empresa, sobre alguien de esa
      // empresa. Por eso lleva organización, al revés que la retirada de plataforma.
      organizationId: params.organizationId,
      actorId: params.ownerUserId,
      action: AUDIT_ACTIONS.MFA_REMOVED_BY_OWNER,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: target.id,
      metadata: { targetName: target.name },
    });

    await this.sendQuietly(
      mfaRemovedByOwnerEmail({
        to: target.email,
        name: target.name,
        ownerName: owner.name,
        organizationName: organization.name,
      }),
    );

    return { success: true };
  }

  /**
   * La plataforma retira el segundo factor. Último recurso.
   *
   * Motivo obligatorio: sin él, la traza diría que alguien de fuera degradó la seguridad de una
   * cuenta de cliente y no por qué, que es la mitad de la pregunta.
   *
   * Se audita con `organizationId: null` y la empresa afectada en `metadata`, como el resto de
   * acciones de plataforma: `AuditLog` cuelga de la organización en cascada, y lo que hizo la
   * plataforma sobre un cliente es justo lo que hay que conservar si ese cliente se va.
   */
  async removeByPlatform(params: {
    actorId: string;
    targetUserId: string;
    reason: string;
  }): Promise<{ success: true }> {
    const reason = params.reason.trim();
    if (reason.length === 0) {
      throw new BadRequestException(
        'Hace falta explicar por qué se retira la verificación en dos pasos.',
      );
    }

    const target = await this.prisma.user.findUnique({
      where: { id: params.targetUserId },
      select: {
        id: true,
        name: true,
        email: true,
        mfaEnabledAt: true,
        memberships: {
          select: {
            organizationId: true,
            organization: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!target) throw new NotFoundException('Usuario no encontrado');
    if (!target.mfaEnabledAt) {
      throw new BadRequestException(
        'Esa cuenta no tiene la verificación en dos pasos activada.',
      );
    }

    await this.mfa.removeFrom(target.id);

    await this.audit.record({
      organizationId: null,
      actorId: params.actorId,
      action: AUDIT_ACTIONS.PLATFORM_MFA_REMOVED,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: target.id,
      metadata: {
        reason,
        targetName: target.name,
        // Las empresas afectadas viajan aquí, no en la columna: ver arriba.
        organizations: target.memberships.map((m) => ({
          organizationId: m.organization.id,
          organizationName: m.organization.name,
        })),
      },
    });

    await this.sendQuietly(
      mfaRemovedByPlatformEmail({
        to: target.email,
        name: target.name,
        reason,
      }),
    );
    await this.notifyOwners(target, reason);

    return { success: true };
  }

  /** A los propietarios de cada empresa a la que pertenece la persona afectada. */
  private async notifyOwners(
    target: {
      id: string;
      name: string;
      memberships: Array<{ organization: { id: string; name: string } }>;
    },
    reason: string,
  ): Promise<void> {
    for (const membership of target.memberships) {
      const owners = await this.prisma.membership.findMany({
        where: {
          organizationId: membership.organization.id,
          role: MembershipRole.OWNER,
          // Si el afectado ES el propietario, ya recibió el suyo: no se le manda dos veces.
          NOT: { userId: target.id },
        },
        select: { user: { select: { name: true, email: true } } },
      });

      for (const owner of owners) {
        await this.sendQuietly(
          mfaRemovedByPlatformOwnerNoticeEmail({
            to: owner.user.email,
            ownerName: owner.user.name,
            affectedName: target.name,
            organizationName: membership.organization.name,
            reason,
          }),
        );
      }
    }
  }

  /**
   * Manda el aviso sin dejar que un fallo de correo deshaga lo hecho.
   *
   * La retirada ya ocurrió cuando se llega aquí. Propagar un error de SMTP devolvería un fallo
   * por algo que sí se hizo, y dejaría a quien llamó sin saber en qué estado quedó la cuenta.
   * El fallo se registra con nivel de error, con lo necesario para reenviarlo a mano — nunca
   * con el contenido del mensaje.
   */
  private async sendQuietly(email: {
    to: string;
    kind: string;
  }): Promise<void> {
    try {
      await this.mailer.send(email as Parameters<MailerPort['send']>[0]);
    } catch (error) {
      this.logger.error(
        `No se pudo enviar el aviso de seguridad (${email.kind})`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { MembershipRole, Prisma } from '@businessbrain/database';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateOrganizationDto } from './dto/update-organization.dto';
import type { CreateInvitationDto } from './dto/create-invitation.dto';
import {
  MEMBERSHIP_DENIED_TO_PLATFORM_ADMIN,
  canHoldMembership,
} from '../common/platform/tenant-separation';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(name: string, ownerId: string) {
    await this.assertCanJoinAnOrganization(ownerId);
    const slug = await this.generateUniqueSlug(name);

    return this.prisma.organization.create({
      data: {
        name,
        slug,
        memberships: {
          create: { userId: ownerId, role: MembershipRole.OWNER },
        },
      },
    });
  }

  async findById(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization)
      throw new NotFoundException('Organización no encontrada');
    return organization;
  }

  /**
   * Actualiza la organización.
   *
   * ## Los ajustes se MEZCLAN, no se reemplazan
   *
   * `settings` es un cajón compartido: guarda la exigencia de fiabilidad, el techo diario de
   * gasto en IA y lo que venga después. Cada pantalla manda solo su parte, así que sustituir
   * el objeto entero hacía que guardar la exigencia de fiabilidad **borrara en silencio** el
   * techo de gasto — y al revés. No se notaba mientras solo hubo un ajuste.
   *
   * La mezcla es de un nivel: cada pantalla es dueña de su apartado (`knowledgeEngine`, `ai`)
   * y lo manda entero. Mezclar en profundidad permitiría dejar un apartado a medias con
   * valores viejos, que es más difícil de explicar que sustituirlo.
   */
  async update(organizationId: string, dto: UpdateOrganizationDto) {
    const current = await this.findById(organizationId);

    const settings =
      dto.settings === undefined
        ? undefined
        : {
            ...(typeof current.settings === 'object' &&
            current.settings !== null
              ? (current.settings as Record<string, unknown>)
              : {}),
            ...dto.settings,
          };

    return this.prisma.organization.update({
      where: { id: organizationId },
      // dto.settings es Record<string, unknown> (validado por class-validator @IsObject());
      // Prisma exige su propio tipo InputJsonValue para columnas Json — es una conversión
      // segura porque ya pasó la validación del DTO, no una aserción a ciegas.
      data: {
        name: dto.name,
        settings: settings as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async listMembers(organizationId: string) {
    return this.prisma.membership.findMany({
      where: { organizationId },
      include: {
        user: {
          select: { id: true, email: true, name: true, avatarUrl: true },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async createInvitation(
    organizationId: string,
    createdById: string,
    dto: CreateInvitationDto,
  ) {
    const token = randomBytes(24).toString('hex');
    return this.prisma.invitation.create({
      data: {
        organizationId,
        email: dto.email,
        role: dto.role ?? MembershipRole.MEMBER,
        token,
        createdById,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
    });
  }

  async acceptInvitation(token: string, userId: string, userEmail: string) {
    await this.assertCanJoinAnOrganization(userId);

    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invitación inválida o expirada');
    }
    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException(
        'Esta invitación fue emitida para otro email',
      );
    }

    const [, membership] = await this.prisma.$transaction([
      this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      }),
      this.prisma.membership.upsert({
        where: {
          userId_organizationId: {
            userId,
            organizationId: invitation.organizationId,
          },
        },
        update: {},
        create: {
          userId,
          organizationId: invitation.organizationId,
          role: invitation.role,
          invitedById: invitation.createdById,
        },
      }),
    ]);

    return membership;
  }

  /**
   * La frontera entre quien opera BusinessBrain y quien lo usa.
   *
   * Se comprueba en los DOS puntos donde nace una membresía —crear empresa y aceptar
   * invitación— y no en el controlador: una comprobación en la superficie se salta con
   * cualquier llamada interna, y esta es la invariante que hace que el administrador de
   * plataforma reciba 403 en toda la API de cliente por el camino normal.
   *
   * Se lee el usuario en vez de confiar en lo que traiga quien llama. Es una consulta más en
   * una operación que ocurre una vez por empresa, y a cambio no hay forma de eludirla.
   */
  private async assertCanJoinAnOrganization(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { platformRole: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (!canHoldMembership(user.platformRole)) {
      throw new ForbiddenException(MEMBERSHIP_DENIED_TO_PLATFORM_ADMIN);
    }
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\p{Diacritic}]/gu, '') // quita acentos (requiere normalize('NFD') antes)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'org';

    let candidate = base;
    let attempt = 0;
    // Con un espacio de nombres pequeño, unas pocas colisiones son razonables antes de rendirse.
    while (
      await this.prisma.organization.findUnique({ where: { slug: candidate } })
    ) {
      attempt += 1;
      if (attempt > 20) {
        throw new ConflictException(
          'No se pudo generar un slug único para la organización',
        );
      }
      candidate = `${base}-${randomBytes(2).toString('hex')}`;
    }
    return candidate;
  }
}

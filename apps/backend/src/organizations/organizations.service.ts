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

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(name: string, ownerId: string) {
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

  async update(organizationId: string, dto: UpdateOrganizationDto) {
    await this.findById(organizationId);
    return this.prisma.organization.update({
      where: { id: organizationId },
      // dto.settings es Record<string, unknown> (validado por class-validator @IsObject());
      // Prisma exige su propio tipo InputJsonValue para columnas Json — es una conversión
      // segura porque ya pasó la validación del DTO, no una aserción a ciegas.
      data: {
        name: dto.name,
        settings: dto.settings as Prisma.InputJsonValue | undefined,
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

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../audit/domain/audit-actions';
import type { PlanTier } from '@businessbrain/database';

const PAGE_SIZE = 20;

// page=abc en la query string llega como NaN tras Number(); sin este guard, Prisma
// recibiría un `skip` inválido y respondería con un 500 en vez de simplemente usar la página 1.
function normalizePage(page?: number): number {
  return Number.isInteger(page) && (page as number) > 0 ? (page as number) : 1;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async stats() {
    const [totalUsers, totalOrganizations, bannedUsers, usersByPlan] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.organization.count(),
        this.prisma.user.count({ where: { status: 'BANNED' } }),
        this.prisma.organization.groupBy({ by: ['planTier'], _count: true }),
      ]);

    return {
      totalUsers,
      totalOrganizations,
      bannedUsers,
      organizationsByPlan: Object.fromEntries(
        usersByPlan.map((row) => [row.planTier, row._count]),
      ),
    };
  }

  async listOrganizations(rawPage?: number) {
    const page = normalizePage(rawPage);
    const [items, total] = await Promise.all([
      this.prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.organization.count(),
    ]);
    return { items, total, page, pages: Math.ceil(total / PAGE_SIZE) };
  }

  async listUsers(rawPage?: number) {
    const page = normalizePage(rawPage);
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          platformRole: true,
          status: true,
          createdAt: true,
          lastActiveAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.user.count(),
    ]);
    return { items, total, page, pages: Math.ceil(total / PAGE_SIZE) };
  }

  async toggleUserBan(userId: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const nextStatus = user.status === 'BANNED' ? 'ACTIVE' : 'BANNED';
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: nextStatus },
    });

    await this.audit.record({
      actorId,
      action:
        nextStatus === 'BANNED'
          ? AUDIT_ACTIONS.USER_BANNED
          : AUDIT_ACTIONS.USER_UNBANNED,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: userId,
      metadata: { previousStatus: user.status, newStatus: nextStatus },
    });

    return { id: updated.id, status: updated.status };
  }

  async changeOrganizationPlan(
    organizationId: string,
    planTier: PlanTier,
    actorId: string,
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization)
      throw new NotFoundException('Organización no encontrada');

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { planTier },
    });

    await this.audit.record({
      actorId,
      organizationId,
      action: AUDIT_ACTIONS.ORGANIZATION_PLAN_CHANGED,
      targetType: AUDIT_TARGET_TYPES.ORGANIZATION,
      targetId: organizationId,
      metadata: { from: organization.planTier, to: planTier },
    });

    return { id: updated.id, planTier: updated.planTier };
  }
}

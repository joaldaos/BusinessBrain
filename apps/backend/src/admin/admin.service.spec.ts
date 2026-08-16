import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: {
    user: {
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    organization: {
      count: jest.Mock;
      groupBy: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    auditLog: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: {
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      organization: {
        count: jest.fn(),
        groupBy: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        // `AuditService` REAL sobre el mismo doble de Prisma: la traza es parte del
        // comportamiento que estos tests comprueban, no un detalle a silenciar.
        AuditService,
      ],
    }).compile();

    service = moduleRef.get(AdminService);
  });

  describe('toggleUserBan', () => {
    it('lanza NotFoundException si el usuario no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.toggleUserBan('does-not-exist', 'actor-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('banea a un usuario activo y deja rastro en AuditLog', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        status: 'ACTIVE',
      });
      prisma.user.update.mockResolvedValue({ id: 'usr-1', status: 'BANNED' });

      const result = await service.toggleUserBan('usr-1', 'actor-1');

      expect(result).toEqual({ id: 'usr-1', status: 'BANNED' });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'user.banned',
            actorId: 'actor-1',
            targetId: 'usr-1',
          }),
        }),
      );
    });

    it('desbanea a un usuario baneado (toggle bidireccional)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        status: 'BANNED',
      });
      prisma.user.update.mockResolvedValue({ id: 'usr-1', status: 'ACTIVE' });

      const result = await service.toggleUserBan('usr-1', 'actor-1');

      expect(result.status).toBe('ACTIVE');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'user.unbanned' }),
        }),
      );
    });
  });

  describe('changeOrganizationPlan', () => {
    it('registra el plan anterior y el nuevo en el AuditLog', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        planTier: 'FREE',
      });
      prisma.organization.update.mockResolvedValue({
        id: 'org-1',
        planTier: 'PRO',
      });

      await service.changeOrganizationPlan('org-1', 'PRO', 'actor-1');

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: { from: 'FREE', to: 'PRO' },
          }),
        }),
      );
    });
  });
});

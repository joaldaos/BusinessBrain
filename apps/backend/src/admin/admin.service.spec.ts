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
            action: 'platform.user.banned',
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
          data: expect.objectContaining({ action: 'platform.user.unbanned' }),
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
            metadata: expect.objectContaining({ from: 'FREE', to: 'PRO' }),
          }),
        }),
      );
    });

    it('CRÍTICO: la traza NO cuelga de la organización', async () => {
      // `AuditLog` cae en cascada con la organización: registrar la acción con su
      // identificador la haría desaparecer al borrar la empresa, que es justo cuando hay que
      // poder demostrar qué se le hizo. La organización viaja en `metadata`.
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Panadería Ruiz',
        planTier: 'FREE',
      });
      prisma.organization.update.mockResolvedValue({
        id: 'org-1',
        planTier: 'PRO',
      });

      await service.changeOrganizationPlan('org-1', 'PRO', 'actor-1');

      const escrito = prisma.auditLog.create.mock.calls.at(-1)?.[0] as {
        data: {
          organizationId: string | null;
          metadata: Record<string, unknown>;
        };
      };
      expect(escrito.data.organizationId).toBeNull();
      expect(escrito.data.metadata).toMatchObject({
        organizationId: 'org-1',
        organizationName: 'Panadería Ruiz',
      });
    });
  });

  describe('lo que la plataforma NO ve de sus clientes', () => {
    it('CRÍTICO: el listado de organizaciones no devuelve su configuración', async () => {
      // `settings` acumula configuración del cliente —techo de gasto, exigencia de
      // fiabilidad— y un `findMany` sin `select` la entrega entera. El día que ahí se guarde
      // algo sensible, la administración lo estaría leyendo sin que nadie lo decidiera.
      prisma.organization.findMany.mockResolvedValue([]);
      prisma.organization.count.mockResolvedValue(0);

      await service.listOrganizations(1);

      const consulta = prisma.organization.findMany.mock.calls.at(-1)?.[0] as {
        select?: Record<string, unknown>;
      };
      expect(consulta.select).toBeDefined();
      expect(consulta.select).not.toHaveProperty('settings');
    });

    it('CRÍTICO: leer la lista de personas deja rastro', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', email: 'ana@cliente.es' },
      ]);
      prisma.user.count.mockResolvedValue(1);

      await service.listUsers(1, 'actor-1');

      const escrito = prisma.auditLog.create.mock.calls.at(-1)?.[0] as {
        data: { action: string; actorId: string; metadata: unknown };
      };
      expect(escrito.data.action).toBe('platform.users.listed');
      expect(escrito.data.actorId).toBe('actor-1');
      // El recuento, no los correos: una auditoría que los copiara sería un segundo almacén
      // de los mismos datos personales.
      expect(JSON.stringify(escrito.data.metadata)).not.toContain(
        'ana@cliente.es',
      );
    });
  });
});

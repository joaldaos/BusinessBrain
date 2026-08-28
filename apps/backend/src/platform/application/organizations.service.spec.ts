import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PlatformOrganizationsService } from './organizations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

describe('el catálogo de clientes', () => {
  let service: PlatformOrganizationsService;
  let prisma: {
    user: { count: jest.Mock };
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
      user: { count: jest.fn() },
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
        PlatformOrganizationsService,
        { provide: PrismaService, useValue: prisma },
        // `AuditService` REAL sobre el mismo doble de Prisma: la traza es parte del
        // comportamiento que estos tests comprueban, no un detalle a silenciar.
        AuditService,
      ],
    }).compile();

    service = moduleRef.get(PlatformOrganizationsService);
  });

  describe('cambiar el plan', () => {
    it('lanza si la organización no existe', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.changePlan({
          organizationId: 'no-existe',
          planTier: 'PRO',
          actorId: 'actor-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('registra el plan anterior y el nuevo', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Panadería Ruiz',
        planTier: 'FREE',
      });
      prisma.organization.update.mockResolvedValue({
        id: 'org-1',
        planTier: 'PRO',
      });

      await service.changePlan({
        organizationId: 'org-1',
        planTier: 'PRO',
        actorId: 'actor-1',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'platform.organization.plan_changed',
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

      await service.changePlan({
        organizationId: 'org-1',
        planTier: 'PRO',
        actorId: 'actor-1',
      });

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

    it('un cambio al mismo plan no escribe nada', async () => {
      // Una traza llena de entradas que no cambiaron nada es ruido que hace más difícil
      // encontrar las que sí.
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Panadería Ruiz',
        planTier: 'PRO',
      });

      const resultado = await service.changePlan({
        organizationId: 'org-1',
        planTier: 'PRO',
        actorId: 'actor-1',
      });

      expect(resultado.changed).toBe(false);
      expect(prisma.organization.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('lo que la plataforma NO ve de sus clientes', () => {
    it('CRÍTICO: el listado no devuelve su configuración', async () => {
      // `settings` acumula configuración del cliente —techo de gasto, exigencia de
      // fiabilidad— y un `findMany` sin `select` la entrega entera. El día que ahí se guarde
      // algo sensible, la administración lo estaría leyendo sin que nadie lo decidiera.
      prisma.organization.findMany.mockResolvedValue([]);
      prisma.organization.count.mockResolvedValue(0);

      await service.list(1);

      const consulta = prisma.organization.findMany.mock.calls.at(-1)?.[0] as {
        select?: Record<string, unknown>;
      };
      expect(consulta.select).toBeDefined();
      expect(consulta.select).not.toHaveProperty('settings');
    });

    it('CRÍTICO: la ficha de una empresa devuelve EXACTAMENTE lo mismo que el listado', async () => {
      // Que exista una ruta para una sola empresa es comodidad de la interfaz. Si por serlo
      // devolviera un campo más, sería una puerta más ancha que la lista sin que nadie lo
      // hubiera decidido — y esa es la forma normal en que estas cosas se ensanchan.
      prisma.organization.findMany.mockResolvedValue([]);
      prisma.organization.count.mockResolvedValue(0);
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });

      await service.list(1);
      await service.detail('org-1');

      const delListado = prisma.organization.findMany.mock.calls.at(
        -1,
      )?.[0] as {
        select: Record<string, unknown>;
      };
      const deLaFicha = prisma.organization.findUnique.mock.calls.at(
        -1,
      )?.[0] as {
        select: Record<string, unknown>;
      };

      expect(deLaFicha.select).toEqual(delListado.select);
    });

    it('CRÍTICO: el cambio de plan tampoco lee la fila entera', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'X',
        planTier: 'FREE',
      });
      prisma.organization.update.mockResolvedValue({
        id: 'org-1',
        planTier: 'PRO',
      });

      await service.changePlan({
        organizationId: 'org-1',
        planTier: 'PRO',
        actorId: 'actor-1',
      });

      const lectura = prisma.organization.findUnique.mock.calls.at(-1)?.[0] as {
        select?: Record<string, unknown>;
      };
      expect(lectura.select).toBeDefined();
      expect(lectura.select).not.toHaveProperty('settings');
    });
  });

  describe('los números del producto', () => {
    it('son agregados de la plataforma, no de ninguna empresa', async () => {
      prisma.user.count.mockResolvedValue(12);
      prisma.organization.count.mockResolvedValue(3);
      prisma.organization.groupBy.mockResolvedValue([
        { planTier: 'FREE', _count: 2 },
        { planTier: 'PRO', _count: 1 },
      ]);

      const resultado = await service.overview();

      expect(resultado).toEqual({
        totalUsers: 12,
        totalOrganizations: 3,
        bannedUsers: 12,
        organizationsByPlan: { FREE: 2, PRO: 1 },
      });
    });
  });
});

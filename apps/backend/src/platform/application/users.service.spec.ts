import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PlatformUsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

describe('las personas, desde la administración del producto', () => {
  let service: PlatformUsersService;
  let prisma: {
    user: {
      count: jest.Mock;
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
      auditLog: { create: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformUsersService,
        { provide: PrismaService, useValue: prisma },
        AuditService,
      ],
    }).compile();

    service = moduleRef.get(PlatformUsersService);
  });

  const activo = {
    id: 'usr-1',
    email: 'ana@cliente.es',
    name: 'Ana',
    platformRole: 'USER',
    status: 'ACTIVE',
    createdAt: new Date(),
    lastActiveAt: null,
    mfaEnabledAt: null,
  };

  describe('bloquear y desbloquear', () => {
    it('lanza si la persona no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.setBanned({ userId: 'no', banned: true, actorId: 'a' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('bloquea y deja rastro', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        status: 'ACTIVE',
        platformRole: 'USER',
      });
      prisma.user.update.mockResolvedValue({ id: 'usr-1', status: 'BANNED' });

      const resultado = await service.setBanned({
        userId: 'usr-1',
        banned: true,
        actorId: 'actor-1',
      });

      expect(resultado).toEqual({
        id: 'usr-1',
        status: 'BANNED',
        changed: true,
      });
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

    it('desbloquea, y es una acción con nombre propio', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        status: 'BANNED',
        platformRole: 'USER',
      });
      prisma.user.update.mockResolvedValue({ id: 'usr-1', status: 'ACTIVE' });

      await service.setBanned({
        userId: 'usr-1',
        banned: false,
        actorId: 'actor-1',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'platform.user.unbanned' }),
        }),
      );
    });

    it('CRÍTICO: repetir la llamada no deshace lo hecho', async () => {
      // Era un interruptor, y un doble clic se anulaba a sí mismo dejando dos entradas de
      // auditoría contradictorias. Declarando el estado destino, repetir es inofensivo.
      prisma.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        status: 'BANNED',
        platformRole: 'USER',
      });

      const resultado = await service.setBanned({
        userId: 'usr-1',
        banned: true,
        actorId: 'actor-1',
      });

      expect(resultado).toEqual({
        id: 'usr-1',
        status: 'BANNED',
        changed: false,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('CRÍTICO: no se puede bloquear una cuenta de plataforma', async () => {
      // Bloquearse a uno mismo deja el producto sin nadie que pueda desbloquearlo, y bloquear
      // al otro administrador permite que quien comprometa una cuenta deje fuera a quien
      // podría pararle.
      prisma.user.findUnique.mockResolvedValue({
        id: 'admin-2',
        status: 'ACTIVE',
        platformRole: 'SUPERADMIN',
      });

      await expect(
        service.setBanned({
          userId: 'admin-2',
          banned: true,
          actorId: 'admin-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('lo que se ve y lo que no', () => {
    it('CRÍTICO: la consulta no trae contraseñas ni el secreto del segundo factor', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.list({ page: 1, actorId: 'actor-1' });

      const consulta = prisma.user.findMany.mock.calls.at(-1)?.[0] as {
        select: Record<string, unknown>;
      };
      expect(consulta.select).toBeDefined();
      for (const prohibido of [
        'passwordHash',
        'mfaSecretEnc',
        'refreshTokens',
        'mfaRecoveryCodes',
        'passwordResets',
        'authSessions',
      ]) {
        expect(consulta.select).not.toHaveProperty(prohibido);
      }
    });

    it('CRÍTICO: del segundo factor sale un booleano, nunca la fecha ni el secreto', async () => {
      prisma.user.findMany.mockResolvedValue([
        { ...activo, mfaEnabledAt: new Date('2026-01-01') },
      ]);
      prisma.user.count.mockResolvedValue(1);

      const pagina = await service.list({ page: 1, actorId: 'actor-1' });

      expect(pagina.items[0]).toMatchObject({ mfaEnabled: true });
      expect(pagina.items[0]).not.toHaveProperty('mfaEnabledAt');
      expect(JSON.stringify(pagina.items[0])).not.toContain('2026-01-01');
    });

    it('CRÍTICO: leer la lista deja rastro, sin copiar los correos', async () => {
      prisma.user.findMany.mockResolvedValue([activo]);
      prisma.user.count.mockResolvedValue(1);

      await service.list({ page: 1, actorId: 'actor-1' });

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

    it('abrir la ficha de una persona también deja rastro', async () => {
      // Es una lectura más dirigida que el listado: quien la abre sabe exactamente a quién
      // está mirando.
      prisma.user.findUnique.mockResolvedValue({ ...activo, memberships: [] });

      await service.detail({ userId: 'usr-1', actorId: 'actor-1' });

      const escrito = prisma.auditLog.create.mock.calls.at(-1)?.[0] as {
        data: { action: string; targetId: string };
      };
      expect(escrito.data.action).toBe('platform.users.listed');
      expect(escrito.data.targetId).toBe('usr-1');
    });

    it('la ficha dice a qué empresas pertenece, para poder atender "no puedo entrar"', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activo,
        memberships: [
          { role: 'OWNER', organization: { id: 'org-1', name: 'Panadería' } },
        ],
      });

      const ficha = await service.detail({
        userId: 'usr-1',
        actorId: 'actor-1',
      });

      expect(ficha.organizations).toEqual([
        { id: 'org-1', name: 'Panadería', role: 'OWNER' },
      ]);
      expect(ficha).not.toHaveProperty('memberships');
    });
  });
});

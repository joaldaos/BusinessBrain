import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { PrismaService } from '../prisma/prisma.service';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prisma: {
    user: { findUnique: jest.Mock };
    organization: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    membership: { findMany: jest.Mock; upsert: jest.Mock };
    invitation: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      // Toda membresía nueva comprueba antes que quien la pide no sea una cuenta de
      // administración de plataforma. Por defecto, una cuenta de cliente normal.
      user: {
        findUnique: jest.fn().mockResolvedValue({ platformRole: 'USER' }),
      },
      organization: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      membership: { findMany: jest.fn(), upsert: jest.fn() },
      invitation: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(OrganizationsService);
  });

  describe('create', () => {
    it('genera un slug único a partir del nombre, con acentos y símbolos normalizados', async () => {
      prisma.organization.findUnique.mockResolvedValue(null); // slug libre a la primera
      prisma.organization.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'org-1', ...data }),
      );

      const org = await service.create('Café & Diseño S.L.', 'usr-1');

      expect(org.slug).toBe('cafe-diseno-s-l');
      expect(prisma.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            memberships: { create: { userId: 'usr-1', role: 'OWNER' } },
          }),
        }),
      );
    });

    it('añade un sufijo si el slug ya existe', async () => {
      prisma.organization.findUnique
        .mockResolvedValueOnce({ id: 'existing' })
        .mockResolvedValueOnce(null);
      prisma.organization.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'org-2', ...data }),
      );

      const org = await service.create('Acme', 'usr-1');

      expect(org.slug).toMatch(/^acme-[0-9a-f]{4}$/);
    });
  });

  describe('acceptInvitation', () => {
    it('rechaza una invitación expirada', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        email: 'a@b.dev',
        acceptedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.acceptInvitation('tok', 'usr-1', 'a@b.dev'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza si el email del usuario no coincide con el de la invitación', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        email: 'invited@b.dev',
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 100000),
      });

      await expect(
        service.acceptInvitation('tok', 'usr-1', 'someone-else@b.dev'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  /**
   * La frontera entre quien opera BusinessBrain y quien lo usa.
   *
   * Se comprueba en el SERVICIO y no en el controlador: una comprobación en la superficie se
   * salta con cualquier llamada interna, y esta es la invariante que hace que el administrador
   * de plataforma reciba 403 en toda la API de cliente por el camino normal, sin necesitar
   * ninguna excepción que alguien pueda olvidar.
   */
  describe('administrar la plataforma y pertenecer a una empresa son incompatibles', () => {
    it('CRÍTICO: una cuenta de plataforma no puede crear una empresa', async () => {
      // Sería la vía evidente para saltarse el aislamiento: crearse una organización y entrar
      // por la puerta normal como propietario.
      prisma.user.findUnique.mockResolvedValue({ platformRole: 'SUPERADMIN' });

      await expect(
        service.create('Puerta trasera', 'admin-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // Y se detiene antes de tocar nada: ni siquiera busca si el slug está libre.
      expect(prisma.organization.create).not.toHaveBeenCalled();
    });

    it('CRÍTICO: tampoco puede aceptar una invitación', async () => {
      // La otra vía: que alguien de dentro le invite. La frontera se cruza en los dos
      // sentidos, y por eso se comprueba en los dos puntos donde nace una membresía.
      prisma.user.findUnique.mockResolvedValue({ platformRole: 'SUPERADMIN' });

      await expect(
        service.acceptInvitation(
          'un-token',
          'admin-1',
          'admin@businessbrain.dev',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.membership.upsert).not.toHaveBeenCalled();
    });
  });
});

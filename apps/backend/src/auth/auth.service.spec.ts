import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    refreshToken: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  const fakeConfig: Record<string, unknown> = {
    'jwt.accessSecret': 'access-secret-for-tests-only',
    'jwt.accessExpiration': '15m',
    'jwt.refreshSecret': 'refresh-secret-for-tests-only',
    'jwt.refreshExpiration': '30d',
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      refreshToken: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: new JwtService({}) },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => fakeConfig[key] },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('register', () => {
    it('rechaza un email ya registrado', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(
        service.register({
          email: 'taken@businessbrain.dev',
          password: 'password123',
          name: 'X',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('crea el usuario con la contraseña hasheada, nunca en texto plano', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'usr-1',
          ...data,
          avatarUrl: null,
          platformRole: 'USER',
          createdAt: new Date(),
        }),
      );

      await service.register({
        email: 'new@businessbrain.dev',
        password: 'password123',
        name: 'Nueva',
      });

      const createdData = prisma.user.create.mock.calls[0][0].data;
      expect(createdData.passwordHash).not.toBe('password123');
      expect(
        await bcrypt.compare('password123', createdData.passwordHash),
      ).toBe(true);
    });
  });

  describe('validateCredentials', () => {
    it('devuelve null si el usuario está baneado, aunque la contraseña sea correcta', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        passwordHash,
        status: 'BANNED',
      });

      const result = await service.validateCredentials(
        'banned@businessbrain.dev',
        'password123',
      );
      expect(result).toBeNull();
    });

    it('devuelve null si la contraseña no coincide', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'usr-1',
        passwordHash,
        status: 'ACTIVE',
      });

      const result = await service.validateCredentials(
        'user@businessbrain.dev',
        'wrong-password',
      );
      expect(result).toBeNull();
    });
  });

  describe('refresh', () => {
    it('rechaza un refresh token que no existe, expiró o ya fue revocado', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(null);
      await expect(service.refresh('does-not-exist')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rota el token: revoca el usado y emite un par nuevo', async () => {
      const user = {
        id: 'usr-1',
        email: 'u@x.dev',
        name: 'U',
        platformRole: 'USER',
      };
      prisma.refreshToken.findFirst.mockResolvedValue({ id: 'rt-1', user });
      prisma.refreshToken.create.mockResolvedValue({});
      prisma.user.update.mockResolvedValue({});

      const tokens = await service.refresh('some-valid-token');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });
      expect(tokens.accessToken).toEqual(expect.any(String));
      expect(tokens.refreshToken).toEqual(expect.any(String));
    });
  });
});

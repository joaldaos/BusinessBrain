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
    authSession: {
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
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
      authSession: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // `refresh` rota token y sesión en una transacción: aquí basta con dejar pasar las
      // promesas que se le entregan.
      $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
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

    it('rota el token DENTRO de la misma sesión', async () => {
      const user = {
        id: 'usr-1',
        email: 'u@x.dev',
        name: 'U',
        platformRole: 'USER',
        status: 'ACTIVE',
      };
      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        userId: 'usr-1',
        sessionId: 'ses-1',
        user,
        session: { id: 'ses-1', revokedAt: null },
      });
      prisma.refreshToken.create.mockResolvedValue({});
      prisma.user.update.mockResolvedValue({});

      const tokens = await service.refresh('some-valid-token');

      // La sesión NO cambia: es lo que permite que una reautenticación de hace tres minutos
      // siga valiendo después de refrescar. Si el refresco abriera sesión nueva, la ventana
      // se perdería cada quince minutos sin que nadie se enterara.
      expect(tokens.sessionId).toBe('ses-1');
      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sessionId: 'ses-1' }),
      });
      expect(tokens.accessToken).toEqual(expect.any(String));
      expect(tokens.refreshToken).toEqual(expect.any(String));
    });

    it('CRÍTICO: una sesión revocada no refresca', async () => {
      // Cerrar sesión revoca la sesión. Si el refresco no lo mirara, el token de refresco
      // seguiría emitiendo accesos nuevos y "he cerrado sesión" no significaría nada.
      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        userId: 'usr-1',
        sessionId: 'ses-1',
        user: { id: 'usr-1', status: 'ACTIVE' },
        session: { id: 'ses-1', revokedAt: new Date() },
      });

      await expect(
        service.refresh('token-de-sesion-cerrada'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('el testigo del segundo paso', () => {
    it('CRÍTICO: no lleva identificador de sesión, así que no vale como token de acceso', () => {
      // `JwtStrategy` exige `sid` y rechaza cualquier cosa con `purpose`. Si este testigo
      // pasara por ahí, presentarlo saltaría el segundo factor entero: la contraseña volvería
      // a ser suficiente y todo lo demás sería decorado.
      const testigo = service.issueMfaChallenge('usr-1');
      const [, cuerpo] = testigo.split('.');
      const payload = JSON.parse(
        Buffer.from(cuerpo, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;

      expect(payload.sid).toBeUndefined();
      expect(payload.purpose).toBe('mfa_challenge');
      expect(payload.sub).toBe('usr-1');
    });

    it('devuelve de quién es', () => {
      expect(
        service.verifyMfaChallenge(service.issueMfaChallenge('usr-7')),
      ).toBe('usr-7');
    });

    it('CRÍTICO: un token de acceso normal no sirve como testigo del segundo paso', () => {
      // La comprobación va en los dos sentidos. Sin esto, quien consiguiera un token de
      // acceso de quince minutos podría usarlo para completar el segundo paso de otra sesión.
      const accesoNormal = new JwtService({}).sign(
        { sub: 'usr-1', sid: 'ses-1' },
        { secret: fakeConfig['jwt.accessSecret'] as string },
      );

      expect(() => service.verifyMfaChallenge(accesoNormal)).toThrow(
        UnauthorizedException,
      );
    });
  });
});

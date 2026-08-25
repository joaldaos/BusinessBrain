import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { AppConfig } from '../config/configuration';
import type { RegisterDto } from './dto/register.dto';
import type { User } from '@businessbrain/database';
import type { Locale } from '../common/i18n/locales';

const BCRYPT_ROUNDS = 10;
const REFRESH_TOKEN_BYTES = 32;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  platformRole: User['platformRole'];
  createdAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async register(dto: RegisterDto): Promise<PublicUser> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con ese email');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash, name: dto.name },
    });

    return this.toPublicUser(user);
  }

  async validateCredentials(
    email: string,
    password: string,
  ): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status === 'BANNED') return null;

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    return passwordMatches ? user : null;
  }

  async issueTokens(user: User): Promise<AuthTokens> {
    const accessToken = this.jwtService.sign(
      { sub: user.id },
      {
        secret: this.configService.get('jwt.accessSecret', { infer: true }),
        expiresIn: this.configService.get('jwt.accessExpiration', {
          infer: true,
        }),
      },
    );

    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const expiresAt = this.computeRefreshExpiry();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt,
      },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });

    return { accessToken, refreshToken };
  }

  /** Rota el refresh token: revoca el usado y emite un par nuevo (access + refresh). */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(stored.user);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Guarda el idioma elegido.
   *
   * Vive en el usuario y no en la organización: dos personas de la misma empresa pueden
   * querer el producto en idiomas distintos, y eso no es un caso raro — una gestoría con un
   * cliente francés tiene exactamente ese problema.
   */
  async setLocale(userId: string, locale: Locale): Promise<{ locale: Locale }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { locale },
    });

    return { locale };
  }

  toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      platformRole: user.platformRole,
      createdAt: user.createdAt,
    };
  }

  private hashRefreshToken(token: string): string {
    // HMAC (no un simple sha256) para que, si la tabla RefreshToken se filtrase,
    // no baste con recalcular el hash sin conocer también JWT_REFRESH_SECRET.
    const secret = this.configService.get('jwt.refreshSecret', { infer: true });
    return createHmac('sha256', secret).update(token).digest('hex');
  }

  /**
   * Cuánto vive el refresco, en milisegundos.
   *
   * Lo necesita el controlador para que la cookie caduque a la vez que el token que lleva
   * dentro. Si la cookie viviera más, el navegador seguiría enviando algo que el servidor ya
   * rechaza, y cada arranque intentaría refrescar en vano.
   */
  refreshTokenLifetimeMs(): number {
    return this.computeRefreshExpiry().getTime() - Date.now();
  }

  private computeRefreshExpiry(): Date {
    const expiration = this.configService.get('jwt.refreshExpiration', {
      infer: true,
    });
    const match = /^(\d+)([smhd])$/.exec(expiration);
    if (!match) {
      throw new Error(
        `JWT_REFRESH_EXPIRATION con formato inválido: ${expiration}`,
      );
    }
    const [, amountStr, unit] = match;
    const amount = Number(amountStr);
    const unitMs: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return new Date(Date.now() + amount * unitMs[unit]);
  }
}

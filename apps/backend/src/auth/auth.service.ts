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

/**
 * Coste del hasheo de contraseñas. Vive aquí, y `PasswordResetService` lo importa de aquí:
 * estaba duplicado en dos ficheros, y dos constantes iguales en dos sitios son una que alguien
 * sube y otra que se queda atrás.
 */
export const BCRYPT_ROUNDS = 10;

const REFRESH_TOKEN_BYTES = 32;

/**
 * Cuánto vale el testigo intermedio entre la contraseña y el segundo factor.
 *
 * Cinco minutos: lo que tarda alguien en desbloquear el móvil, abrir la aplicación y teclear
 * seis dígitos, con margen para no encontrarla a la primera. Más tiempo sería un testigo de
 * media sesión colgando de una contraseña ya usada.
 */
const MFA_CHALLENGE_TTL = '5m';

/** Marca el testigo del segundo paso para que NO pueda usarse como token de acceso. */
const MFA_CHALLENGE_PURPOSE = 'mfa_challenge';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface StartedSession extends AuthTokens {
  sessionId: string;
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

  /**
   * La persona detrás de un testigo de segundo paso, si sigue pudiendo entrar.
   *
   * Se relee de la base de datos en vez de arrastrarla desde el primer paso: entre la
   * contraseña y el código pueden pasar cinco minutos, y en ese rato una cuenta puede quedar
   * bloqueada. Aceptar un código de una cuenta baneada porque la contraseña era correcta hace
   * cinco minutos sería un agujero silencioso.
   */
  async requireActiveUser(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status === 'BANNED') {
      throw new UnauthorizedException('Usuario no válido');
    }
    return user;
  }

  /** ¿Es esta la contraseña de esta persona? Para reautenticarse y para cambiarla. */
  async passwordMatches(userId: string, password: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) return false;

    return bcrypt.compare(password, user.passwordHash);
  }

  /**
   * Empieza una sesión nueva.
   *
   * La SESIÓN es lo que sobrevive a la rotación del token de refresco, y su identificador viaja
   * dentro del token de acceso. Sin ella, "reautenticado hace tres minutos" se perdería en el
   * siguiente refresco: una garantía que se evapora sola es peor que no tenerla, porque nadie
   * se entera de cuándo dejó de aplicar.
   */
  async startSession(user: User): Promise<StartedSession> {
    const session = await this.prisma.authSession.create({
      data: { userId: user.id },
    });

    const tokens = await this.issueTokens(user.id, session.id);
    return { ...tokens, sessionId: session.id };
  }

  /**
   * Rota el refresco dentro de LA MISMA sesión.
   *
   * El token usado se revoca y nace otro, pero `sessionId` no cambia — ese es justo el punto de
   * que exista la sesión. Una sesión revocada no refresca: comprobarlo aquí es lo que hace que
   * cerrar sesión en un sitio corte de verdad, y no solo hasta el siguiente refresco.
   */
  async refresh(refreshToken: string): Promise<StartedSession> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true, session: true },
    });

    if (!stored || stored.session.revokedAt) {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
    if (stored.user.status === 'BANNED') {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.authSession.update({
        where: { id: stored.sessionId },
        data: { lastUsedAt: new Date() },
      }),
    ]);

    const tokens = await this.issueTokens(stored.userId, stored.sessionId);
    return { ...tokens, sessionId: stored.sessionId };
  }

  /** Cerrar sesión cierra LA SESIÓN, no solo el token que se presentó. */
  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      select: { sessionId: true },
    });
    if (!stored) return;

    await this.revokeSessions({ sessionIds: [stored.sessionId] });
  }

  /**
   * Cierra sesiones y los tokens que colgaban de ellas.
   *
   * `except` existe para el cambio de contraseña: se tiran todas las demás y se conserva
   * aquella desde la que se está actuando. Cerrarle la sesión a quien acaba de demostrar quién
   * es, en la pantalla en la que está, sería castigar la acción correcta.
   */
  async revokeSessions(params: {
    userId?: string;
    sessionIds?: string[];
    except?: string;
  }): Promise<void> {
    const where = {
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.sessionIds ? { id: { in: params.sessionIds } } : {}),
      ...(params.except ? { NOT: { id: params.except } } : {}),
      revokedAt: null,
    };

    const sessions = await this.prisma.authSession.findMany({
      where,
      select: { id: true },
    });
    if (sessions.length === 0) return;

    const ids = sessions.map((session) => session.id);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.authSession.updateMany({
        where: { id: { in: ids } },
        data: { revokedAt: now },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId: { in: ids }, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
  }

  /**
   * El testigo del segundo paso.
   *
   * Demuestra que la contraseña era correcta y NADA MÁS. Lleva `purpose` y no lleva `sid`, y
   * `JwtStrategy` rechaza ambas cosas: si se presentara como token de acceso, no autentica a
   * nadie. Sin esa separación, el primer paso del inicio de sesión sería el inicio de sesión
   * entero y el segundo factor no protegería nada.
   */
  issueMfaChallenge(userId: string): string {
    return this.jwtService.sign(
      { sub: userId, purpose: MFA_CHALLENGE_PURPOSE },
      {
        secret: this.configService.get('jwt.accessSecret', { infer: true }),
        expiresIn: MFA_CHALLENGE_TTL,
      },
    );
  }

  /** Devuelve de quién es el testigo del segundo paso, o falla. */
  verifyMfaChallenge(token: string): string {
    let payload: { sub?: unknown; purpose?: unknown };
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get('jwt.accessSecret', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException(
        'Se ha agotado el tiempo para introducir el código. Vuelve a entrar con tu contraseña.',
      );
    }

    // Un token de ACCESO no puede colarse aquí: sin el propósito exacto, no vale.
    if (
      payload.purpose !== MFA_CHALLENGE_PURPOSE ||
      typeof payload.sub !== 'string'
    ) {
      throw new UnauthorizedException(
        'Se ha agotado el tiempo para introducir el código. Vuelve a entrar con tu contraseña.',
      );
    }

    return payload.sub;
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

  private async issueTokens(
    userId: string,
    sessionId: string,
  ): Promise<AuthTokens> {
    const accessToken = this.jwtService.sign(
      { sub: userId, sid: sessionId },
      {
        secret: this.configService.get('jwt.accessSecret', { infer: true }),
        expiresIn: this.configService.get('jwt.accessExpiration', {
          infer: true,
        }),
      },
    );

    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        sessionId,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt: this.computeRefreshExpiry(),
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { lastActiveAt: new Date() },
    });

    return { accessToken, refreshToken };
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

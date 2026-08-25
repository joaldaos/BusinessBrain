import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import type { AppConfig } from '../../config/configuration';
import type { RequestUser } from '../../common/types/authenticated-request';
import { DEFAULT_LOCALE, isSupportedLocale } from '../../common/i18n/locales';

interface JwtPayload {
  sub: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.accessSecret', { infer: true }),
    });
  }

  /**
   * Se ejecuta en cada request autenticado: carga el usuario y sus membresías
   * frescas desde la base de datos (no se confía en datos embebidos en el JWT
   * más allá del id), para que un cambio de rol o un ban surtan efecto de inmediato
   * sin esperar a que expire el access token.
   */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        memberships: { select: { organizationId: true, role: true } },
      },
    });

    if (!user || user.status === 'BANNED') {
      throw new UnauthorizedException('Usuario no válido');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      platformRole: user.platformRole,
      // Se resuelve AQUÍ, una sola vez, en vez de dejar que cada consumidor decida qué hacer
      // con un nulo. Un idioma sin resolver acabaría con alguna pantalla —o el chat— cayendo
      // a un idioma distinto del resto.
      locale: isSupportedLocale(user.locale) ? user.locale : DEFAULT_LOCALE,
      memberships: user.memberships,
    };
  }
}

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
  /** La sesión a la que pertenece este token. Obligatoria — ver abajo. */
  sid?: unknown;
  /** Presente solo en testigos que NO son de acceso (el del segundo paso). */
  purpose?: unknown;
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
   *
   * ## Dos rechazos que son la mitad de la Fase 4
   *
   * **Sin `sid`, no se pasa.** El identificador de sesión es lo que permite saber de QUÉ sesión
   * viene una petición, y sin él no hay forma de comprobar si esa sesión se reautenticó ni si
   * alguien la cerró. Un token sin sesión solo puede ser uno emitido antes de que las sesiones
   * existieran.
   *
   * **Con `purpose`, tampoco.** El testigo del segundo paso del inicio de sesión va firmado con
   * el mismo secreto —es el mismo emisor— y demuestra únicamente que la contraseña era
   * correcta. Si se aceptara aquí, presentarlo como token de acceso saltaría el segundo factor
   * entero: la contraseña volvería a ser suficiente y todo lo demás sería decorado.
   *
   * ## Y por qué se comprueba la sesión en cada petición
   *
   * Cerrar sesión revoca la sesión, no el token de acceso que ya se emitió: un JWT no se puede
   * retirar. Si no se mirara aquí, cerrar sesión dejaría el token vivo hasta quince minutos
   * después — y "he cerrado sesión" tiene que significar que se cerró.
   */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    if (payload.purpose !== undefined || typeof payload.sid !== 'string') {
      throw new UnauthorizedException('Usuario no válido');
    }

    const [user, session] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: {
          memberships: { select: { organizationId: true, role: true } },
        },
      }),
      this.prisma.authSession.findUnique({
        where: { id: payload.sid },
        select: {
          id: true,
          userId: true,
          revokedAt: true,
          reauthenticatedAt: true,
        },
      }),
    ]);

    if (!user || user.status === 'BANNED') {
      throw new UnauthorizedException('Usuario no válido');
    }
    // La sesión tiene que ser de esta persona: un `sid` de otra cuenta no vale ni aunque
    // ambos tokens estén bien firmados.
    if (!session || session.revokedAt || session.userId !== user.id) {
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
      sessionId: session.id,
      reauthenticatedAt: session.reauthenticatedAt,
      // Lo que activa la verificación es la FECHA, no el secreto: un alta abandonada a medias
      // deja secreto sin fecha, y esa cuenta no tiene segundo factor.
      mfaEnabled: user.mfaEnabledAt !== null,
    };
  }
}

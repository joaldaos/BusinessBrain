import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { MAILER, type MailerPort } from '../../mail/domain/mailer.port';
import { BCRYPT_ROUNDS } from '../auth.service';
import {
  PASSWORD_RESET_LIFETIME_MS,
  generateResetToken,
  hashResetToken,
  passwordResetEmail,
  resetLinkFor,
} from '../domain/password-reset';
import type { AppConfig } from '../../config/configuration';

// El coste vive en `AuthService` y se importa de allí. Estaba duplicado en los dos ficheros, y
// dos constantes iguales en dos sitios son una que alguien sube y otra que se queda atrás — con
// el resultado de que la misma contraseña se protege distinto según por dónde se cambie.

/**
 * Recuperar el acceso sin que nadie toque la base de datos.
 *
 * Era el segundo bloqueante para vender: un cliente que olvidaba su contraseña se quedaba
 * fuera y solo se le podía rescatar entrando a mano en Postgres. Con cinco pilotos, eso ocurre
 * la primera semana.
 *
 * ## Por qué la petición NO dice si el correo existe
 *
 * Responder "no hay ninguna cuenta con ese correo" convierte esta pantalla en un buscador de
 * clientes: cualquiera puede probar direcciones y quedarse con las que existen. Para una PYME
 * eso es su lista de proveedores o de empleados. La respuesta es siempre la misma, exista la
 * cuenta o no.
 *
 * Queda una diferencia de TIEMPO —crear un testigo tarda algo más que no crearlo— que en
 * teoría permitiría distinguirlos. No se intenta igualar con esperas artificiales, que son
 * frágiles y engañosas: lo que cierra esa puerta es el límite de peticiones (ver
 * `throttler`), porque una medición así necesita cientos de intentos.
 *
 * ## Por qué cambiar la contraseña cierra todas las sesiones
 *
 * Alguien recupera su contraseña justamente cuando sospecha que otro entró. Si las sesiones
 * abiertas siguieran vivas, el intruso conservaría el acceso y la recuperación no habría
 * servido de nada.
 *
 * ## Y por qué NO desactiva la verificación en dos pasos
 *
 * Es la puerta trasera evidente: si el enlace del correo quitara el segundo factor, quien
 * controlara el buzón de una persona entraría en su cuenta con una sola prueba, y el segundo
 * factor no protegería exactamente del escenario para el que se instala.
 *
 * La consecuencia es deliberada y hay que asumirla: quien pierde a la vez la contraseña, el
 * móvil y los códigos de papel NO se rescata con este flujo. Se rescata con los códigos de
 * recuperación, o pidiendo que alguien le retire el segundo factor —el propietario de su
 * empresa, o la administración— que son caminos motivados y auditados. Que la recuperación
 * por correo sea insuficiente en ese caso es el precio de que sea insuficiente también para
 * quien no debería entrar.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
    @Inject(MAILER) private readonly mailer: MailerPort,
  ) {}

  /**
   * Manda el enlace, si hay a quién.
   *
   * No devuelve nada y no falla nunca por culpa del correo: quien llama no debe poder deducir
   * del resultado si la cuenta existe.
   */
  async request(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Una cuenta bloqueada se trata como inexistente. Devolverle el acceso a alguien a quien
    // se le retiró a propósito sería peor que dejarle fuera.
    if (!user || user.status === 'BANNED') return;

    const token = generateResetToken();

    await this.prisma.$transaction([
      // Solo vale el último enlace pedido. Si alguien recibe tres correos porque pulsó tres
      // veces, que funcione el que tiene delante y no uno de hace media hora.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hash(token),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_LIFETIME_MS),
        },
      }),
    ]);

    const link = resetLinkFor(this.frontendUrl(), token);

    try {
      await this.mailer.send(
        passwordResetEmail({ to: user.email, name: user.name, link }),
      );
    } catch (error) {
      // Que falle el envío no puede propagarse a la respuesta: el mensaje de error revelaría
      // que la cuenta existe. Se registra el fallo SIN el enlace.
      this.logger.error(
        `No se pudo enviar el correo de recuperación al usuario ${user.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Cambia la contraseña con el testigo del enlace.
   *
   * El paso a "usado" es una transición CONDICIONAL —`usedAt: null` en el `where`— y no una
   * lectura seguida de una escritura. Dos peticiones simultáneas con el mismo enlace: solo una
   * encuentra la fila sin usar, y la otra se queda sin nada que actualizar. Comprobar y luego
   * escribir dejaría pasar a las dos.
   */
  async confirm(token: string, newPassword: string): Promise<void> {
    const stored = await this.prisma.passwordResetToken.findFirst({
      where: {
        tokenHash: this.hash(token),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!stored) throw this.linkNoLongerValid();

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    const [marcado] = await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { id: stored.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: stored.userId },
        // La verificación en dos pasos NO se toca. Ver la cabecera de la clase.
        data: { passwordHash },
      }),
      // Todas las SESIONES caen, no solo sus tokens de refresco. Revocar únicamente los
      // refrescos dejaría vivo el token de acceso ya emitido hasta quince minutos después —
      // y quien recupera su contraseña porque sospecha que otro entró necesita que ese otro
      // salga ahora, no en un rato.
      this.prisma.authSession.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    if (marcado.count === 0) throw this.linkNoLongerValid();
  }

  /**
   * El mismo error para caducado, ya usado e inventado.
   *
   * Distinguirlos ayudaría a quien prueba testigos al azar a saber cuándo ha acertado uno. Y a
   * la persona que sí lo pidió no le sirve de nada la diferencia: en los tres casos tiene que
   * pedir otro.
   */
  private linkNoLongerValid(): BadRequestException {
    return new BadRequestException(
      'Este enlace ya no sirve. Puede que haya caducado o que ya lo hayas usado. Pide uno nuevo desde la pantalla de entrada.',
    );
  }

  private hash(token: string): string {
    return hashResetToken(
      token,
      this.configService.get('jwt.refreshSecret', { infer: true }),
    );
  }

  /**
   * A dónde apunta el enlace.
   *
   * En producción `FRONTEND_URL` es obligatoria, así que el respaldo solo se usa en local,
   * donde la interfaz vive siempre en el puerto de Vite.
   */
  private frontendUrl(): string {
    return (
      this.configService.get('frontendUrl', { infer: true }) ??
      'http://localhost:5173'
    );
  }
}

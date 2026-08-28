import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService, type AuthTokens } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  ConfirmPasswordResetDto,
  RequestPasswordResetDto,
} from './dto/password-reset.dto';
import { PasswordResetService } from './application/password-reset.service';
import { MfaService } from './application/mfa.service';
import { ReauthenticationService } from './application/reauthentication.service';
import {
  ChangePasswordDto,
  LoginMfaDto,
  ReauthenticateDto,
} from './dto/mfa.dto';
import { RecentAuthGuard } from '../common/guards/recent-auth.guard';
import { RequiresRecentAuth } from '../common/decorators/requires-recent-auth.decorator';
import {
  SENSITIVE_ACTIONS,
  reauthenticatedUntil,
} from '../common/security/sensitive-actions';
import { RateLimited } from '../common/decorators/rate-limited.decorator';
import { SetLanguageDto } from './dto/set-language.dto';
import type { Locale } from '../common/i18n/locales';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { CsrfGuard } from './guards/csrf.guard';
import {
  CSRF_COOKIE,
  REFRESH_COOKIE,
  generateCsrfToken,
  readCookie,
  sessionCookieOptions,
} from './domain/session-cookies';
import type { RequestUser } from '../common/types/authenticated-request';
import type { User } from '@businessbrain/database';
import type { AppConfig } from '../config/configuration';

/**
 * Autenticación.
 *
 * El token de ACCESO viaja en el cuerpo y vive en memoria de la interfaz: dura quince minutos
 * y es el que se manda en `Authorization`. El de REFRESCO, que dura mucho más, ya no sale
 * nunca en una respuesta legible — viaja en una cookie `HttpOnly` que ningún script puede
 * leer. Ver `domain/session-cookies.ts` para el razonamiento completo.
 *
 * Consecuencia deliberada: **`/auth/refresh` y `/auth/logout` ya no aceptan el token en el
 * cuerpo**. Seguir aceptándolo dejaría abierta exactamente la puerta que este cambio cierra,
 * y bastaría con que un cliente antiguo la usara para que el token volviera a ser legible.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly mfa: MfaService,
    private readonly reauthentication: ReauthenticationService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  @Public()
  @RateLimited('register')
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * El orden de estos dos guards NO es cosmético.
   *
   * Los decoradores se aplican de abajo arriba, y los guards se ejecutan en ese mismo orden.
   * Con `@RateLimited` encima, `LocalAuthGuard` corría PRIMERO y devolvía 401 por contraseña
   * incorrecta — el límite no llegaba a contar nada, y probar contraseñas era gratis. El
   * límite tiene que contar el intento antes de que nadie lo juzgue.
   */
  @Public()
  @UseGuards(LocalAuthGuard)
  @RateLimited('login')
  @Post('login')
  async login(
    @Body() _dto: LoginDto,
    @Req() req: { user: User },
    @Res({ passthrough: true }) response: Response,
  ) {
    // Con verificación en dos pasos, la contraseña correcta NO abre sesión: devuelve el
    // testigo del segundo paso y ahí se queda. Ningún camino de aquí abajo se ejecuta hasta
    // que llegue un código válido — que es lo que hace que el segundo factor sea un factor y
    // no un aviso.
    if (req.user.mfaEnabledAt) {
      return {
        mfaRequired: true,
        mfaToken: this.authService.issueMfaChallenge(req.user.id),
      };
    }

    return this.completeLogin(response, req.user);
  }

  /**
   * El segundo paso: el código de la aplicación, o uno de papel.
   *
   * `@Public` porque todavía no hay sesión — lo que autentica es el testigo del paso anterior
   * junto con el código. Un testigo sin código no sirve, y un código sin testigo tampoco.
   *
   * Que el mismo campo acepte las dos cosas es deliberado: quien ha perdido el móvil está
   * agobiado, y obligarle a elegir en un desplegable qué tipo de código está escribiendo es
   * fricción justo donde peor cae.
   */
  @Public()
  @RateLimited('mfa')
  @Post('login/mfa')
  async loginMfa(
    @Body() dto: LoginMfaDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const userId = this.authService.verifyMfaChallenge(dto.mfaToken);
    await this.mfa.verifyCode(userId, dto.code);

    const user = await this.authService.requireActiveUser(userId);
    return this.completeLogin(response, user);
  }

  /**
   * Renueva la sesión con la cookie que el navegador adjunta.
   *
   * `@Public` porque el token de acceso ya ha caducado cuando se llega aquí — autenticar con
   * él haría el refresco inútil. Quien autentica es la cookie, y `CsrfGuard` es lo que impide
   * que la provoque un tercero.
   */
  @Public()
  @UseGuards(CsrfGuard)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Rota el token DENTRO de la misma sesión: `sessionId` no cambia, así que una
    // reautenticación de hace tres minutos sigue valiendo después de refrescar.
    const tokens = await this.authService.refresh(
      readCookie(req, REFRESH_COOKIE) ?? '',
    );

    return {
      accessToken: tokens.accessToken,
      csrfToken: this.startSession(response, tokens),
    };
  }

  @Public()
  @UseGuards(CsrfGuard)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = readCookie(req, REFRESH_COOKIE);
    if (refreshToken) await this.authService.logout(refreshToken);

    // Las cookies se limpian SIEMPRE, aunque no hubiera token o ya estuviera revocado: dejar
    // al navegador con una cookie muerta haría que cada arranque intentara refrescar contra
    // algo que no existe.
    this.clearSession(response);

    return { success: true };
  }

  /**
   * Quién soy y en qué estado está mi sesión.
   *
   * Devuelve también si la cuenta tiene segundo factor y hasta cuándo vale la última
   * reautenticación. Lo necesita la interfaz para saber QUÉ pedir antes de una acción sensible
   * —código o contraseña— sin tener que provocar un error primero para averiguarlo.
   *
   * Nada de esto es autorización: quien decide sigue siendo `RecentAuthGuard`. Es cortesía de
   * pantalla, igual que ocultar un botón.
   */
  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return {
      ...user,
      reauthenticatedUntil: user.reauthenticatedAt
        ? reauthenticatedUntil(user.reauthenticatedAt)
        : null,
    };
  }

  /**
   * Volver a demostrar quién soy: abre la ventana de quince minutos para ESTA sesión.
   *
   * Con segundo factor se pide el código y la contraseña no vale. Ver
   * `ReauthenticationService` para el porqué.
   */
  @Post('reauthenticate')
  @HttpCode(HttpStatus.OK)
  @RateLimited('mfa')
  async reauthenticate(
    @CurrentUser() user: RequestUser,
    @Body() dto: ReauthenticateDto,
  ) {
    return this.reauthentication.reauthenticate(user, dto);
  }

  /**
   * Cambiar la contraseña desde dentro.
   *
   * No basta con que el token esté vivo: exige haber demostrado la identidad hace menos de
   * quince minutos, con el código si la cuenta tiene segundo factor. Una sesión de hace tres
   * semanas no puede cambiar la contraseña de nadie.
   */
  @Post('password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RecentAuthGuard)
  @RequiresRecentAuth(SENSITIVE_ACTIONS.PASSWORD_CHANGE)
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.reauthentication.changePassword(user, dto.newPassword);
  }

  /**
   * El idioma en el que quiere que se le hable.
   *
   * Se guarda en la persona, no en la organización: dos personas de la misma empresa pueden
   * quererlo distinto, y una gestoría con un cliente francés tiene exactamente ese caso.
   *
   * Devuelve el idioma guardado para que la interfaz confirme lo que quedó, en vez de asumir
   * que se guardó lo que mandó.
   */
  @Patch('me/language')
  async setLanguage(
    @CurrentUser() user: RequestUser,
    @Body() dto: SetLanguageDto,
  ) {
    // El DTO ya validó que es un idioma que hablamos; el estrechamiento de tipo es lo único
    // que falta para que el dominio no vea nunca una cadena cualquiera.
    return this.authService.setLocale(user.id, dto.locale as Locale);
  }

  /**
   * "He olvidado mi contraseña".
   *
   * Responde SIEMPRE lo mismo, exista la cuenta o no. Decir "no hay ninguna cuenta con ese
   * correo" convertiría esta ruta en un buscador de clientes de la competencia.
   *
   * `202` y no `200` porque es literalmente lo que ocurre: se ha aceptado la petición y el
   * correo sale por su cuenta. La interfaz no espera confirmación de entrega, ni podría.
   */
  @Public()
  @RateLimited('passwordResetRequest')
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('password-reset/request')
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    await this.passwordReset.request(dto.email);

    // Ni el testigo ni ninguna pista sobre la cuenta. Solo que la petición se recibió.
    return { success: true };
  }

  /**
   * Elegir la contraseña nueva con el testigo del enlace.
   *
   * No inicia sesión al terminar, a propósito: entrar con la contraseña recién puesta es la
   * comprobación de que se guardó lo que la persona escribió. Iniciar sesión aquí escondería
   * un fallo en el guardado detrás de una sesión que funciona.
   */
  @Public()
  @RateLimited('passwordResetConfirm')
  @HttpCode(HttpStatus.OK)
  @Post('password-reset/confirm')
  async confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    await this.passwordReset.confirm(dto.token, dto.password);
    return { success: true };
  }

  /**
   * Abre la sesión de verdad: cookies, testigo CSRF y token de acceso.
   *
   * Un solo sitio para los dos caminos —con segundo factor y sin él— para que no haya forma de
   * que uno de ellos se quede sin algo que el otro sí hace.
   */
  private async completeLogin(response: Response, user: User) {
    const session = await this.authService.startSession(user);

    return {
      accessToken: session.accessToken,
      csrfToken: this.startSession(response, session),
      user: this.authService.toPublicUser(user),
    };
  }

  /**
   * Fija las cookies de sesión y devuelve el testigo CSRF.
   *
   * El testigo se devuelve además en el cuerpo por comodidad de la interfaz —así no tiene que
   * leer `document.cookie` tras iniciar sesión— y no es un secreto: su valor está en que
   * quien ataca desde otro origen no puede leerlo.
   */
  private startSession(response: Response, tokens: AuthTokens): string {
    const csrfToken = generateCsrfToken();
    const options = sessionCookieOptions({
      isProduction:
        this.configService.get('nodeEnv', { infer: true }) === 'production',
      maxAgeMs: this.authService.refreshTokenLifetimeMs(),
    });

    response.cookie(REFRESH_COOKIE, tokens.refreshToken, options.refresh);
    response.cookie(CSRF_COOKIE, csrfToken, options.csrf);

    return csrfToken;
  }

  private clearSession(response: Response): void {
    const options = sessionCookieOptions({
      isProduction:
        this.configService.get('nodeEnv', { infer: true }) === 'production',
      maxAgeMs: 0,
    });

    response.clearCookie(REFRESH_COOKIE, options.refresh);
    response.clearCookie(CSRF_COOKIE, options.csrf);
  }
}

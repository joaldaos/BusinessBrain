import {
  Body,
  Controller,
  Get,
  HttpCode,
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
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  async login(
    @Body() _dto: LoginDto,
    @Req() req: { user: User },
    @Res({ passthrough: true }) response: Response,
  ) {
    const tokens = await this.authService.issueTokens(req.user);

    return {
      accessToken: tokens.accessToken,
      csrfToken: this.startSession(response, tokens),
      user: this.authService.toPublicUser(req.user),
    };
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

  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return user;
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
  @HttpCode(HttpStatus.OK)
  @Post('password-reset/confirm')
  async confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    await this.passwordReset.confirm(dto.token, dto.password);
    return { success: true };
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

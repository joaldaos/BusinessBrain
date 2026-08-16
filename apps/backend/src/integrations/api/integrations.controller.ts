import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { IntegrationProvider, MembershipRole } from '@businessbrain/database';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { OrgRoles } from '../../common/decorators/roles.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type {
  RequestOrganization,
  RequestUser,
} from '../../common/types/authenticated-request';
import {
  readCookie,
  sessionCookieOptions,
} from '../../auth/domain/session-cookies';
import {
  GOOGLE_DRIVE_PORT,
  type GoogleDrivePort,
} from '../domain/ports/google-drive.port';
import {
  OAUTH_NONCE_COOKIE,
  OAUTH_STATE_TTL_MS,
  buildStatePayload,
  generateNonce,
  verifyStatePayload,
  type OAuthStatePayload,
} from '../domain/oauth-state';
import { IntegrationsService } from '../application/integrations.service';
import { Inject } from '@nestjs/common';
import type { AppConfig } from '../../config/configuration';

/**
 * Conexiones con sistemas externos — primera con OAuth.
 *
 * ## El callback es la superficie más expuesta del sistema
 *
 * Llega por GET, desde el navegador, sin cabecera `Authorization` — así funciona OAuth. Por
 * eso quién conecta y para qué organización viajan dentro de un `state` FIRMADO, y por eso el
 * flujo va atado a una cookie `HttpOnly` que solo tiene el navegador que lo inició. Sin eso,
 * un tercero podría provocar la vuelta con su propio código y dejar la organización de la
 * víctima leyendo el Drive del atacante — con todo lo que entrara indexado como conocimiento
 * propio. Ver `domain/oauth-state.ts`.
 *
 * **Conectar y desconectar exigen ADMIN.** Conceder a BusinessBrain acceso de lectura al Drive
 * de la empresa está al nivel de conceder capacidades a un agente, no al de guardar una
 * preferencia.
 */
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly jwt: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    @Inject(GOOGLE_DRIVE_PORT) private readonly drive: GoogleDrivePort,
  ) {}

  @Get()
  @UseGuards(OrgRoleGuard)
  @OrgRoles(MembershipRole.MEMBER)
  list(@CurrentOrg() org: RequestOrganization) {
    return this.integrations.list(org.id);
  }

  /**
   * Comienza el flujo: devuelve a dónde hay que enviar a la persona.
   *
   * Devuelve la URL en vez de redirigir porque quien llama es la interfaz por `fetch`, no una
   * navegación: un 302 aquí lo seguiría el propio `fetch` y la persona nunca vería la pantalla
   * de Google.
   */
  @Get('google-drive/connect')
  @UseGuards(OrgRoleGuard)
  @OrgRoles(MembershipRole.ADMIN)
  connect(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const nonce = generateNonce();
    const payload = buildStatePayload({
      organizationId: org.id,
      userId: user.id,
      nonce,
    });

    // El nonce en claro solo existe en esta cookie; por la URL viaja únicamente su hash.
    const options = sessionCookieOptions({
      isProduction: this.isProduction(),
      maxAgeMs: OAUTH_STATE_TTL_MS,
    });
    response.cookie(OAUTH_NONCE_COOKIE, nonce, options.refresh);

    return {
      authorizationUrl: this.drive.buildAuthorizationUrl({
        state: this.jwt.sign(payload, {
          secret: this.stateSecret(),
          expiresIn: '10m',
        }),
        redirectUri: this.redirectUri(),
      }),
    };
  }

  /**
   * Vuelta de Google.
   *
   * `@Public` porque no hay sesión aplicativa en una navegación de vuelta; quien autentica es
   * el `state` firmado más la cookie del nonce. Responde con una redirección a la interfaz —
   * aquí sí, porque esto SÍ es una navegación del navegador.
   */
  @Public()
  @Get('google-drive/callback')
  async callback(
    @Req() req: Request,
    @Res() response: Response,
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const uiUrl = this.uiUrl();

    // La cookie del flujo se consume siempre, salga bien o mal: dejarla viva alargaría la
    // ventana en la que un estado robado sigue sirviendo.
    response.clearCookie(
      OAUTH_NONCE_COOKIE,
      sessionCookieOptions({ isProduction: this.isProduction(), maxAgeMs: 0 })
        .refresh,
    );

    if (error) {
      // La persona canceló o Google rechazó. No es un fallo del sistema.
      response.redirect(`${uiUrl}/configuracion?google=cancelado`);
      return;
    }

    try {
      const payload = this.verifyCallback(req, state, code);
      const tokens = await this.drive.exchangeCode({
        code: code!,
        redirectUri: this.redirectUri(),
      });

      await this.integrations.completeConnection({
        organizationId: payload.organizationId,
        userId: payload.userId,
        provider: IntegrationProvider.GOOGLE_DRIVE,
        tokens,
      });

      response.redirect(`${uiUrl}/conocimiento?google=conectado`);
    } catch {
      // El motivo exacto no viaja a la URL: distinguir "estado inválido" de "código
      // caducado" solo ayuda a quien está probando cómo saltárselo. Queda en los registros.
      response.redirect(`${uiUrl}/configuracion?google=error`);
    }
  }

  /** Carpetas del Drive conectado, para elegir cuál se sincroniza. */
  @Get(':integrationId/folders')
  @UseGuards(OrgRoleGuard)
  @OrgRoles(MembershipRole.ADMIN)
  folders(
    @CurrentOrg() org: RequestOrganization,
    @Param('integrationId') integrationId: string,
  ) {
    return this.integrations.listFolders({
      organizationId: org.id,
      integrationId,
    });
  }

  @Delete(':integrationId')
  @UseGuards(OrgRoleGuard)
  @OrgRoles(MembershipRole.ADMIN)
  disconnect(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('integrationId') integrationId: string,
  ) {
    return this.integrations.disconnect({
      organizationId: org.id,
      actorUserId: user.id,
      integrationId,
    });
  }

  /** Valida la vuelta entera. Cualquier rama que no encaje aborta sin conectar nada. */
  private verifyCallback(
    req: Request,
    state?: string,
    code?: string,
  ): OAuthStatePayload {
    if (!state || !code) {
      throw new BadRequestException('Vuelta de Google incompleta');
    }

    const payload: unknown = this.jwt.verify(state, {
      secret: this.stateSecret(),
    });

    const verified = verifyStatePayload({
      payload,
      nonceFromCookie: readCookie(req, OAUTH_NONCE_COOKIE),
    });
    if (!verified.valid) {
      throw new BadRequestException(
        `Vuelta de Google no verificada: ${verified.reason}`,
      );
    }

    return payload as OAuthStatePayload;
  }

  private isProduction(): boolean {
    return this.configService.get('nodeEnv', { infer: true }) === 'production';
  }

  /** El `state` se firma con el secreto de acceso: mismo ciclo de vida y misma custodia. */
  private stateSecret(): string {
    return this.configService.get('jwt.accessSecret', { infer: true });
  }

  private redirectUri(): string {
    return `${process.env.API_PUBLIC_URL ?? 'http://localhost:3999'}/integrations/google-drive/callback`;
  }

  private uiUrl(): string {
    return process.env.WEB_PUBLIC_URL ?? 'http://localhost:5173';
  }
}

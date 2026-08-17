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
import { MembershipRole } from '@businessbrain/database';
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
  oauthFlowCookieOptions,
  readCookie,
} from '../../auth/domain/session-cookies';
import {
  GOOGLE_DRIVE_PORT,
  type GoogleDrivePort,
  type GoogleTokens,
} from '../domain/ports/google-drive.port';
import { GMAIL_PORT, type GmailPort } from '../domain/ports/gmail.port';
import {
  OAUTH_NONCE_COOKIE,
  OAUTH_STATE_TTL_MS,
  buildStatePayload,
  generateNonce,
  verifyStatePayload,
  type GoogleProvider,
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
    @Inject(GMAIL_PORT) private readonly gmail: GmailPort,
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
    return this.beginConnection({
      provider: 'GOOGLE_DRIVE',
      org,
      user,
      response,
      buildUrl: (args) => this.drive.buildAuthorizationUrl(args),
    });
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
    await this.completeCallback({
      provider: 'GOOGLE_DRIVE',
      req,
      response,
      state,
      code,
      error,
      exchange: (args) => this.drive.exchangeCode(args),
    });
  }

  /** Comienza el flujo de Gmail. Mismas garantías que Drive: ver `beginConnection`. */
  @Get('gmail/connect')
  @UseGuards(OrgRoleGuard)
  @OrgRoles(MembershipRole.ADMIN)
  connectGmail(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.beginConnection({
      provider: 'GMAIL',
      org,
      user,
      response,
      buildUrl: (args) => this.gmail.buildAuthorizationUrl(args),
    });
  }

  @Public()
  @Get('gmail/callback')
  async gmailCallback(
    @Req() req: Request,
    @Res() response: Response,
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    await this.completeCallback({
      provider: 'GMAIL',
      req,
      response,
      state,
      code,
      error,
      exchange: (args) => this.gmail.exchangeCode(args),
    });
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

  /** Etiquetas del buzón conectado, para elegir la frontera de sincronización. */
  @Get(':integrationId/labels')
  @UseGuards(OrgRoleGuard)
  @OrgRoles(MembershipRole.ADMIN)
  labels(
    @CurrentOrg() org: RequestOrganization,
    @Param('integrationId') integrationId: string,
  ) {
    return this.integrations.listGmailLabels({
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

  /**
   * Arranca un flujo de OAuth de Google.
   *
   * Compartido por los dos proveedores a propósito: el nonce, la cookie `HttpOnly`, la firma del
   * estado y su TTL son las garantías del flujo, y **duplicarlas por proveedor es exactamente
   * cómo una de ellas se acaba omitiendo** en la tercera integración.
   *
   * Devuelve la URL en vez de redirigir porque quien llama es la interfaz por `fetch`, no una
   * navegación: un 302 aquí lo seguiría el propio `fetch` y la persona nunca vería Google.
   */
  private beginConnection(params: {
    provider: GoogleProvider;
    org: RequestOrganization;
    user: RequestUser;
    response: Response;
    buildUrl: (args: { state: string; redirectUri: string }) => string;
  }): { authorizationUrl: string } {
    const nonce = generateNonce();
    const payload = buildStatePayload({
      organizationId: params.org.id,
      userId: params.user.id,
      provider: params.provider,
      nonce,
    });

    // El nonce en claro solo existe en esta cookie; por la URL viaja únicamente su hash.
    //
    // `SameSite=Lax`, no `Strict`: la vuelta de Google es una navegación desde otro sitio y con
    // `Strict` el navegador no adjuntaría la cookie — conectar seria imposible. Ver
    // `oauthFlowCookieOptions`.
    params.response.cookie(
      OAUTH_NONCE_COOKIE,
      nonce,
      oauthFlowCookieOptions({
        isProduction: this.isProduction(),
        maxAgeMs: OAUTH_STATE_TTL_MS,
      }),
    );

    return {
      authorizationUrl: params.buildUrl({
        state: this.jwt.sign(payload, {
          secret: this.stateSecret(),
          expiresIn: '10m',
        }),
        redirectUri: this.redirectUri(params.provider),
      }),
    };
  }

  /**
   * Cierra la vuelta de Google: verifica, canjea el código y guarda la conexión.
   *
   * Ni el código ni los tokens tocan la respuesta HTTP en ningún momento: lo único que sale de
   * aquí es una redirección con un indicador de resultado.
   */
  private async completeCallback(params: {
    provider: GoogleProvider;
    req: Request;
    response: Response;
    state?: string;
    code?: string;
    error?: string;
    exchange: (args: {
      code: string;
      redirectUri: string;
    }) => Promise<GoogleTokens>;
  }): Promise<void> {
    const uiUrl = this.uiUrl();

    // La cookie del flujo se consume siempre, salga bien o mal: dejarla viva alargaría la
    // ventana en la que un estado robado sigue sirviendo.
    params.response.clearCookie(
      OAUTH_NONCE_COOKIE,
      oauthFlowCookieOptions({ isProduction: this.isProduction(), maxAgeMs: 0 }),
    );

    if (params.error) {
      // La persona canceló o Google rechazó. No es un fallo del sistema.
      params.response.redirect(`${uiUrl}/configuracion?google=cancelado`);
      return;
    }

    try {
      const payload = this.verifyCallback(
        params.provider,
        params.req,
        params.state,
        params.code,
      );
      const tokens = await params.exchange({
        code: params.code!,
        redirectUri: this.redirectUri(params.provider),
      });

      await this.integrations.completeConnection({
        organizationId: payload.organizationId,
        userId: payload.userId,
        provider: params.provider,
        tokens,
      });

      params.response.redirect(`${uiUrl}/conocimiento?google=conectado`);
    } catch {
      // El motivo exacto no viaja a la URL: distinguir "estado inválido" de "código
      // caducado" solo ayuda a quien está probando cómo saltárselo. Queda en los registros.
      params.response.redirect(`${uiUrl}/configuracion?google=error`);
    }
  }

  /** Valida la vuelta entera. Cualquier rama que no encaje aborta sin conectar nada. */
  private verifyCallback(
    provider: GoogleProvider,
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
      // El proveedor de la RUTA. Un estado legítimo de otro flujo no completa esta conexión.
      expectedProvider: provider,
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

  /** Una ruta de vuelta por proveedor: es lo que Google exige registrar y lo que se compara. */
  private redirectUri(provider: GoogleProvider): string {
    const path = provider === 'GMAIL' ? 'gmail' : 'google-drive';
    return `${process.env.API_PUBLIC_URL ?? 'http://localhost:3999'}/integrations/${path}/callback`;
  }

  private uiUrl(): string {
    return process.env.WEB_PUBLIC_URL ?? 'http://localhost:5173';
  }
}

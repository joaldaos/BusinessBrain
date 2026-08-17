import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ConnectionStatus,
  IntegrationProvider,
  type Integration,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/utils/encryption.util';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import {
  GOOGLE_DRIVE_PORT,
  type GoogleDrivePort,
  type GoogleTokens,
} from '../domain/ports/google-drive.port';
import { GMAIL_PORT, type GmailPort } from '../domain/ports/gmail.port';
import {
  GOOGLE_OAUTH_PORT,
  type GoogleOAuthPort,
} from '../domain/ports/google-oauth.port';
import {
  grantedScopesAreSufficient,
  type GoogleProvider,
} from '../domain/oauth-state';

/** Margen antes de dar un token por caducado: no vale renovarlo justo al filo. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * Conexiones con sistemas externos.
 *
 * ## Los tokens de Google no salen nunca
 *
 * Se guardan cifrados con `EncryptionService`, igual que la configuración de una fuente y las
 * claves de LLM. **Ninguna respuesta HTTP los devuelve**, ni siquiera el de acceso: la
 * interfaz no necesita hablar con Google, habla con nosotros. Devolver el de refresco sería
 * entregar acceso permanente al Drive de la empresa a cualquier script de la página.
 *
 * ## Revocar tiene que detener las sincronizaciones
 *
 * Es lo que una persona espera al pulsar "desconectar", y no ocurre solo: hay que decírselo a
 * Google **y** dejar las fuentes que dependían de esa conexión en un estado que impida
 * sincronizar. La relación `Integration → KnowledgeSource` existe precisamente para poder
 * saber cuáles son.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    // Refresco y revocación son comunes a todos los proveedores de Google: este servicio
    // custodia los tokens de cualquiera de ellos y no debe depender del puerto de uno concreto.
    @Inject(GOOGLE_OAUTH_PORT) private readonly oauth: GoogleOAuthPort,
    @Inject(GOOGLE_DRIVE_PORT) private readonly drive: GoogleDrivePort,
    @Inject(GMAIL_PORT) private readonly gmail: GmailPort,
  ) {}

  /** Lo que la interfaz puede ver de una conexión. Jamás incluye tokens. */
  private static readonly PUBLIC_SELECT = {
    id: true,
    provider: true,
    status: true,
    scope: true,
    expiresAt: true,
    // Qué cuenta externa alimenta al sistema. Es identidad de la conexión, no contenido: sin
    // esto, la pantalla solo puede decir "Gmail conectado", y en una empresa con varias
    // cuentas eso no permite auditar nada ni decidir si conviene desconectar.
    accountLabel: true,
    connectedById: true,
    createdAt: true,
    _count: { select: { knowledgeSources: true } },
  } as const;

  list(organizationId: string) {
    return this.prisma.integration.findMany({
      where: { organizationId },
      select: IntegrationsService.PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Guarda la conexión recién autorizada.
   *
   * Idempotente por (organización, proveedor): volver a conectar el mismo proveedor actualiza
   * la conexión existente en vez de crear una segunda. Dos conexiones activas al mismo
   * proveedor dejarían a las fuentes apuntando a una u otra sin criterio.
   */
  async completeConnection(params: {
    organizationId: string;
    userId: string;
    /**
     * Solo proveedores de Google. Acotarlo aquí, y no aceptar el enum entero, impide que un
     * flujo futuro de otro proveedor entre por esta puerta y se le compruebe el permiso
     * equivocado.
     */
    provider: GoogleProvider;
    tokens: GoogleTokens;
  }): Promise<Integration> {
    // Por proveedor, no contra la unión: un consentimiento de solo Drive no debe dar por buena
    // una conexión de Gmail que fallaría en su primera sincronización.
    if (!grantedScopesAreSufficient(params.provider, params.tokens.scope)) {
      throw new BadRequestException(
        params.provider === IntegrationProvider.GMAIL
          ? 'Google no concedió permiso para leer tu correo. Vuelve a conectar y acepta el ' +
              'acceso de solo lectura'
          : 'Google no concedió permiso para leer tu Drive. Vuelve a conectar y acepta el ' +
              'acceso de solo lectura',
      );
    }

    const existing = await this.prisma.integration.findFirst({
      where: {
        organizationId: params.organizationId,
        provider: params.provider,
      },
      select: { id: true, refreshTokenEnc: true },
    });

    // Google solo entrega el token de refresco la PRIMERA vez que se autoriza. Si no viene,
    // se conserva el que ya había: sobrescribirlo con nulo dejaría la conexión viva hasta que
    // caducara el de acceso y muerta después, sin que nadie supiera por qué.
    const refreshTokenEnc = params.tokens.refreshToken
      ? this.encryption.encrypt(params.tokens.refreshToken)
      : (existing?.refreshTokenEnc ?? null);

    if (!refreshTokenEnc) {
      throw new BadRequestException(
        'Google no devolvió un permiso duradero. Revoca el acceso de BusinessBrain en tu ' +
          'cuenta de Google y vuelve a conectar',
      );
    }

    const data = {
      organizationId: params.organizationId,
      provider: params.provider,
      status: ConnectionStatus.CONNECTED,
      accessTokenEnc: this.encryption.encrypt(params.tokens.accessToken),
      refreshTokenEnc,
      scope: params.tokens.scope,
      expiresAt: params.tokens.expiresAt,
      connectedById: params.userId,
    };

    const integration = existing
      ? await this.prisma.integration.update({
          where: { id: existing.id },
          data: { ...data, accountLabel: await this.describeAccount(params) },
        })
      : await this.prisma.integration.create({
          data: { ...data, accountLabel: await this.describeAccount(params) },
        });

    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.userId,
      action: AUDIT_ACTIONS.INTEGRATION_CONNECTED,
      targetType: AUDIT_TARGET_TYPES.INTEGRATION,
      targetId: integration.id,
      metadata: {
        provider: params.provider,
        scope: params.tokens.scope,
        reconnected: existing !== null,
      },
    });

    return integration;
  }

  async findOne(params: {
    organizationId: string;
    integrationId: string;
  }): Promise<Integration> {
    const integration = await this.prisma.integration.findFirst({
      where: {
        id: params.integrationId,
        organizationId: params.organizationId,
      },
    });
    if (!integration) throw new NotFoundException('Conexión no encontrada');

    return integration;
  }

  /**
   * Token de acceso utilizable, renovándolo si hace falta.
   *
   * Es el único punto del sistema que descifra los tokens de Google, y por eso también es
   * donde se comprueba que la conexión sigue viva: una conexión revocada no entrega token,
   * así que ninguna sincronización posterior puede colarse.
   */
  async accessTokenFor(params: {
    organizationId: string;
    integrationId: string;
  }): Promise<string> {
    const integration = await this.findOne(params);

    if (integration.status !== ConnectionStatus.CONNECTED) {
      throw new BadRequestException(
        'La conexión con Google está desactivada. Vuelve a conectarla para poder ' +
          'sincronizar',
      );
    }

    const stillValid =
      integration.accessTokenEnc &&
      integration.expiresAt &&
      integration.expiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now();

    if (stillValid) {
      return this.encryption.decrypt(integration.accessTokenEnc!);
    }

    if (!integration.refreshTokenEnc) {
      await this.markError(integration, 'Sin permiso duradero de Google');
      throw new BadRequestException(
        'La conexión con Google ha caducado. Vuelve a conectarla',
      );
    }

    try {
      const renewed = await this.oauth.refreshTokens(
        this.encryption.decrypt(integration.refreshTokenEnc),
      );

      await this.prisma.integration.update({
        where: { id: integration.id },
        data: {
          accessTokenEnc: this.encryption.encrypt(renewed.accessToken),
          expiresAt: renewed.expiresAt,
          ...(renewed.refreshToken
            ? { refreshTokenEnc: this.encryption.encrypt(renewed.refreshToken) }
            : {}),
        },
      });

      return renewed.accessToken;
    } catch (error) {
      // Que Google rechace el refresco significa, casi siempre, que la persona revocó el
      // acceso desde su cuenta. La conexión pasa a ERROR para que deje de intentarlo cada
      // noche y para que la interfaz pueda decir qué ocurre.
      const message = (error as Error).message;
      await this.markError(integration, message);
      throw new BadRequestException(
        'Google rechazó renovar el acceso. Es probable que se haya revocado desde tu ' +
          'cuenta de Google: vuelve a conectar',
      );
    }
  }

  /**
   * Desconecta: revoca en Google, borra los tokens y **detiene las fuentes que dependían**.
   *
   * Las tres cosas, y en ese orden de importancia. Borrar solo nuestros tokens dejaría el
   * consentimiento vivo en la cuenta de Google; no tocar las fuentes dejaría automatizaciones
   * intentando sincronizar cada noche contra una conexión que ya no existe.
   */
  async disconnect(params: {
    organizationId: string;
    actorUserId: string;
    integrationId: string;
  }): Promise<{ id: string; stoppedSources: number }> {
    const integration = await this.findOne(params);

    if (integration.refreshTokenEnc) {
      try {
        await this.oauth.revoke(
          this.encryption.decrypt(integration.refreshTokenEnc),
        );
      } catch (error) {
        // Si Google no responde, la desconexión sigue adelante: dejar los tokens aquí
        // "porque el proveedor no contesta" sería lo contrario de lo que se ha pedido.
        this.logger.warn(
          `Google no confirmó la revocación de ${integration.id}: ` +
            `${(error as Error).message}. Se desconecta igualmente`,
        );
      }
    }

    // Las fuentes quedan en ERROR, no se borran: su conocimiento ya ingerido sigue siendo
    // válido y consultable. Lo que se detiene es traer más.
    const stopped = await this.prisma.knowledgeSource.updateMany({
      where: {
        integrationId: integration.id,
        organizationId: params.organizationId,
      },
      data: {
        status: ConnectionStatus.ERROR,
        lastError: 'La conexión con Google fue desconectada',
      },
    });

    await this.prisma.integration.update({
      where: { id: integration.id },
      data: {
        status: ConnectionStatus.DISABLED,
        accessTokenEnc: null,
        refreshTokenEnc: null,
        expiresAt: null,
      },
    });

    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.actorUserId,
      action: AUDIT_ACTIONS.INTEGRATION_DISCONNECTED,
      targetType: AUDIT_TARGET_TYPES.INTEGRATION,
      targetId: integration.id,
      metadata: {
        provider: integration.provider,
        stoppedSources: stopped.count,
        tokensCleared: true,
      },
    });

    return { id: integration.id, stoppedSources: stopped.count };
  }

  /** Carpetas del Drive conectado, para que la persona elija cuál se sincroniza. */
  async listFolders(params: { organizationId: string; integrationId: string }) {
    const accessToken = await this.accessTokenFor(params);
    return this.drive.listFolders({ accessToken });
  }

  /**
   * Etiquetas del buzón conectado, para que la persona elija la frontera de sincronización.
   *
   * Exige que la conexión SEA de Gmail: sin esa comprobación, pasar el identificador de la
   * conexión de Drive gastaría su token contra la API de Gmail y devolvería un error opaco.
   */
  async listGmailLabels(params: {
    organizationId: string;
    integrationId: string;
  }) {
    const integration = await this.findOne(params);
    if (integration.provider !== IntegrationProvider.GMAIL) {
      throw new BadRequestException('Esa conexión no es de Gmail');
    }

    const accessToken = await this.accessTokenFor(params);
    return this.gmail.listLabels({ accessToken });
  }

  /**
   * A qué cuenta externa quedó conectado, para poder decirlo en la interfaz.
   *
   * Un fallo aquí NO impide conectar: es una etiqueta informativa, y perder la conexión entera
   * porque Google no contesta a una consulta de perfil sería desproporcionado. Se queda nula y
   * la interfaz lo dice.
   */
  private async describeAccount(params: {
    provider: GoogleProvider;
    tokens: GoogleTokens;
  }): Promise<string | null> {
    if (params.provider !== IntegrationProvider.GMAIL) return null;

    try {
      return await this.gmail.accountEmail({
        accessToken: params.tokens.accessToken,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo leer la cuenta de Gmail conectada: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async markError(
    integration: Integration,
    message: string,
  ): Promise<void> {
    await this.prisma.integration.update({
      where: { id: integration.id },
      data: { status: ConnectionStatus.ERROR },
    });
    await this.prisma.knowledgeSource.updateMany({
      where: { integrationId: integration.id },
      data: { status: ConnectionStatus.ERROR, lastError: message },
    });
  }
}

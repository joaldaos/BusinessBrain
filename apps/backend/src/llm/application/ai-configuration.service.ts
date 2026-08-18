import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LlmProviderName } from '@businessbrain/database';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/utils/encryption.util';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import { ProviderRegistry } from './provider-registry.service';
import {
  CONFIGURABLE_PROVIDERS,
  describeConfiguration,
  isConfigurableProvider,
  providerCatalogEntry,
  type AiConfigurationStatus,
} from '../domain/ai-configuration';
import { OFFICIAL_EMBEDDING_MODEL } from '../domain/embedding-model';
import type { AppConfig } from '../../config/configuration';

/**
 * La IA de una organización, configurable desde la interfaz.
 *
 * ## Por qué esto es lo primero que necesita una empresa
 *
 * Sin un proveedor de IA, BusinessBrain no puede vectorizar lo que entra —y sin vectores, nada
 * de lo que sube la empresa se puede preguntar— ni responder. Hasta ahora la única forma de
 * configurarlo era escribir en la base de datos: una instalación nueva nacía muerta.
 *
 * ## La clave nunca vuelve a salir
 *
 * Se guarda cifrada con `EncryptionService`, igual que los tokens de Google y la config de una
 * fuente. **Ninguna respuesta la devuelve**, ni siquiera enmascarada: lo único que se dice es si
 * existe. Una clave de un proveedor de modelos es dinero directo de la empresa, y devolverla
 * "para rellenar el formulario" la pondría al alcance de cualquier script de la página.
 *
 * ## Se comprueba ANTES de guardar
 *
 * Y se comprueba pidiendo un embedding real, no un ping cualquiera: es exactamente la capacidad
 * de la que depende el producto. Una clave válida para conversar pero sin acceso a embeddings
 * dejaría a la empresa subiendo documentos que nunca podría preguntar, y el fallo aparecería
 * mucho después, lejos de la pantalla donde se pegó la clave.
 */
@Injectable()
export class AiConfigurationService {
  private readonly logger = new Logger(AiConfigurationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly registry: ProviderRegistry,
    private readonly audit: AuditService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /** Qué proveedores puede elegir una empresa, con la ayuda para encontrar su clave. */
  catalog() {
    return CONFIGURABLE_PROVIDERS;
  }

  /**
   * Estado actual: si funciona, con qué y de quién es la clave.
   *
   * Nunca devuelve la clave. `hasOwnKey` es todo lo que la interfaz necesita saber.
   */
  async status(organizationId: string): Promise<AiConfigurationStatus> {
    const own = await this.prisma.llmProfile.findFirst({
      where: { organizationId, isDefault: true },
      select: { provider: true, modelName: true, apiKeyEnc: true },
    });

    const platform = await this.prisma.llmProfile.findFirst({
      where: { organizationId: null, isDefault: true },
      select: { provider: true, modelName: true },
    });

    return describeConfiguration({
      own: own
        ? {
            provider: own.provider,
            modelName: own.modelName,
            hasKey: own.apiKeyEnc !== null,
          }
        : null,
      // La de plataforma solo vale si además hay una clave detrás: un perfil sin clave
      // utilizable diría "listo" y fallaría en la primera pregunta.
      platformAvailable: Boolean(platform) && this.platformKeyExists(),
      platformProvider: platform?.provider ?? null,
      platformModel: platform?.modelName ?? null,
    });
  }

  /**
   * Guarda la configuración de la organización, comprobándola antes.
   *
   * Idempotente por organización: reconfigurar ACTUALIZA el perfil existente en vez de crear un
   * segundo. Dos perfiles por defecto dejarían la elección del modelo al azar de una consulta.
   */
  async configure(params: {
    organizationId: string;
    actorUserId: string;
    provider: string;
    apiKey: string;
    modelName?: string;
  }): Promise<AiConfigurationStatus> {
    if (!isConfigurableProvider(params.provider)) {
      throw new BadRequestException(
        'Ese proveedor de inteligencia artificial no está disponible todavía.',
      );
    }

    const catalogEntry = providerCatalogEntry(params.provider)!;
    const apiKey = params.apiKey.trim();
    if (apiKey.length === 0) {
      throw new BadRequestException('Escribe la clave de tu proveedor de IA.');
    }

    const modelName = params.modelName?.trim() || catalogEntry.defaultModel;

    // Se comprueba ANTES de escribir nada: guardar una clave que no funciona dejaría la
    // empresa creyendo que ya está lista.
    await this.verify(params.provider, apiKey);

    const existing = await this.prisma.llmProfile.findFirst({
      where: { organizationId: params.organizationId, isDefault: true },
      select: { id: true },
    });

    const data = {
      organizationId: params.organizationId,
      provider: params.provider,
      modelName,
      apiKeyEnc: this.encryption.encrypt(apiKey),
      isDefault: true,
    };

    const profile = existing
      ? await this.prisma.llmProfile.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.llmProfile.create({ data });

    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.actorUserId,
      action: AUDIT_ACTIONS.AI_CONFIGURED,
      targetType: AUDIT_TARGET_TYPES.LLM_PROFILE,
      targetId: profile.id,
      // Ni la clave ni un fragmento de ella: solo qué se eligió y si se reconfiguró.
      metadata: {
        provider: params.provider,
        modelName,
        reconfigured: existing !== null,
      },
    });

    return this.status(params.organizationId);
  }

  /**
   * Retira la clave propia y vuelve a la incluida en el servicio, si la hay.
   *
   * Se borra el perfil entero en vez de vaciar la clave: un perfil sin clave seguiría ganando
   * al de plataforma y dejaría a la empresa sin IA sin haberlo pedido.
   */
  async removeOwnKey(params: {
    organizationId: string;
    actorUserId: string;
  }): Promise<AiConfigurationStatus> {
    const { count } = await this.prisma.llmProfile.deleteMany({
      where: { organizationId: params.organizationId },
    });

    if (count > 0) {
      await this.audit.record({
        organizationId: params.organizationId,
        actorId: params.actorUserId,
        action: AUDIT_ACTIONS.AI_KEY_REMOVED,
        targetType: AUDIT_TARGET_TYPES.LLM_PROFILE,
        targetId: params.organizationId,
        metadata: { removedProfiles: count },
      });
    }

    return this.status(params.organizationId);
  }

  /**
   * Comprueba la clave pidiendo un embedding real.
   *
   * Se traduce cualquier fallo del proveedor a algo que una PYME pueda entender y actuar. El
   * motivo técnico queda en los registros: decirle a alguien "401 Unauthorized" no le dice qué
   * hacer, y decirle el cuerpo entero de la respuesta puede filtrar detalles de su cuenta.
   */
  private async verify(
    provider: LlmProviderName,
    apiKey: string,
  ): Promise<void> {
    try {
      const embeddings = this.registry.getEmbeddingProvider(provider);
      const [vector] = await embeddings.embed(
        ['comprobación de la clave'],
        OFFICIAL_EMBEDDING_MODEL,
        apiKey,
      );

      if (!Array.isArray(vector) || vector.length === 0) {
        throw new Error('respuesta vacía del proveedor');
      }
    } catch (error) {
      const detail = (error as Error).message;
      this.logger.warn(`Comprobación de clave de IA fallida: ${detail}`);

      throw new BadRequestException(explainVerificationFailure(detail));
    }
  }

  /** ¿Trae la plataforma una clave utilizable? */
  private platformKeyExists(): boolean {
    const keys = this.configService.get('llmPlatformKeys', { infer: true });
    return Boolean(keys?.openai ?? keys?.anthropic);
  }
}

/**
 * De un fallo del proveedor a una frase accionable.
 *
 * Tres casos cubren casi todo lo que le pasa a una PYME al pegar una clave, y el resto cae en
 * un mensaje genérico que no promete un diagnóstico que no tenemos. Ninguno menciona códigos
 * HTTP, nombres de clase ni variables de entorno.
 */
export function explainVerificationFailure(detail: string): string {
  const lower = detail.toLowerCase();

  if (
    lower.includes('401') ||
    lower.includes('invalid') ||
    lower.includes('unauthorized')
  ) {
    return (
      'Tu proveedor no ha aceptado esa clave. Comprueba que la has copiado entera y que sigue ' +
      'activa en tu cuenta.'
    );
  }

  if (
    lower.includes('429') ||
    lower.includes('quota') ||
    lower.includes('billing')
  ) {
    return (
      'La clave es válida pero tu cuenta del proveedor no admite más consumo ahora mismo. ' +
      'Revisa el saldo o el límite de uso en tu cuenta y vuelve a intentarlo.'
    );
  }

  if (
    lower.includes('fetch') ||
    lower.includes('network') ||
    lower.includes('timeout')
  ) {
    return (
      'No hemos podido contactar con tu proveedor de inteligencia artificial. Inténtalo de ' +
      'nuevo en unos minutos.'
    );
  }

  return (
    'No hemos podido validar esa clave con tu proveedor. Comprueba que es correcta y que tu ' +
    'cuenta permite generar respuestas.'
  );
}

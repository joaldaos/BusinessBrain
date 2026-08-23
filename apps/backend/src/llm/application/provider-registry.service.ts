import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { LlmProviderName, type LlmProfile } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/utils/encryption.util';
import { AnthropicProvider } from '../infrastructure/providers/anthropic.provider';
import { OpenAiProvider } from '../infrastructure/providers/openai.provider';
import type { LlmProviderPort } from '../domain/ports/llm-provider.port';
import type { EmbeddingProviderPort } from '../domain/ports/embedding-provider.port';
import { AiUsageService } from './ai-usage.service';
import { charactersInMessages, charactersInTexts } from '../domain/ai-budget';

/**
 * Perfil resuelto y LISTO PARA USAR.
 *
 * `profile` viene sin `apiKeyEnc` a propósito, y la clave ya descifrada viaja aparte. No es
 * cosmético: hasta ahora seis consumidores pasaban `profile.apiKeyEnc` —el texto CIFRADO— como
 * si fuera la clave del proveedor, y nadie lo descifraba en ningún punto del sistema. No se
 * notaba porque no existía forma de crear un `LlmProfile`, así que la columna siempre estaba
 * vacía y todo caía a la clave de plataforma. En cuanto una empresa guarda la suya, esas seis
 * rutas mandarían el cifrado a OpenAI y fallarían con un error de autenticación incomprensible.
 *
 * Entregar la clave ya utilizable, y NO entregar la cifrada, hace que ese error no pueda
 * repetirse: quien consume no tiene el texto cifrado en la mano.
 */
export interface ResolvedLlmProfile {
  profile: Omit<LlmProfile, 'apiKeyEnc'>;
  provider: LlmProviderPort;
  /** Clave de la organización ya descifrada, o `undefined` para usar la de plataforma. */
  apiKey: string | undefined;
}

/**
 * Único punto del sistema que sabe qué proveedores concretos existen.
 * Todo consumidor (Conversations, Agents, Knowledge Engine...) pasa por aquí,
 * nunca instancia AnthropicProvider/OpenAiProvider directamente.
 *
 * Y único punto que descifra una clave de IA, por el mismo motivo por el que
 * `IntegrationsService.accessTokenFor` es el único que descifra los tokens de Google: un
 * secreto que se descifra en varios sitios acaba descifrándose mal en alguno.
 */
@Injectable()
export class ProviderRegistry {
  private readonly llmProviders: Partial<
    Record<LlmProviderName, LlmProviderPort>
  >;
  private readonly embeddingProviders: Partial<
    Record<LlmProviderName, EmbeddingProviderPort>
  >;

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly usage: AiUsageService,
    anthropicProvider: AnthropicProvider,
    openAiProvider: OpenAiProvider,
  ) {
    // GEMINI/MISTRAL/OLLAMA están en el enum LlmProviderName (schema aprobado) pero
    // sin implementación todavía — es exactamente lo que pidió validarse en la Fase 1:
    // el enum/schema ya soporta 5 proveedores, el código soporta 2 y crece sin
    // tocar el modelo de datos ni el resto de módulos.
    this.llmProviders = {
      [LlmProviderName.ANTHROPIC]: anthropicProvider,
      [LlmProviderName.OPENAI]: openAiProvider,
    };
    this.embeddingProviders = {
      [LlmProviderName.OPENAI]: openAiProvider,
    };
  }

  getLlmProvider(name: LlmProviderName): LlmProviderPort {
    const provider = this.llmProviders[name];
    if (!provider) {
      // Configuración que apunta a un proveedor que esta versión no implementa. Tampoco es
      // un fallo del código: es un `LlmProfile` que hay que corregir.
      throw new ServiceUnavailableException(
        `El perfil de IA declara el proveedor "${name}", que esta versión de la plataforma ` +
          `no implementa todavía (disponibles: ${Object.keys(this.llmProviders).join(', ')})`,
      );
    }
    return provider;
  }

  getEmbeddingProvider(name: LlmProviderName): EmbeddingProviderPort {
    const provider = this.embeddingProviders[name];
    if (!provider) {
      throw new ServiceUnavailableException(
        `El perfil de IA declara el proveedor de embeddings "${name}", que esta versión de ` +
          `la plataforma no implementa todavía (disponibles: ` +
          `${Object.keys(this.embeddingProviders).join(', ')})`,
      );
    }
    return provider;
  }

  /**
   * Resuelve el LlmProfile activo de una organización: el suyo marcado `isDefault`
   * si existe, si no el de plataforma (organizationId null, isDefault). La
   * selección de proveedor depende ÚNICAMENTE de qué fila exista en LlmProfile —
   * cambiar de Anthropic a OpenAI para una organización es un UPDATE, no un deploy.
   */
  async resolveForOrganization(
    organizationId: string,
  ): Promise<ResolvedLlmProfile> {
    const orgProfile = await this.prisma.llmProfile.findFirst({
      where: { organizationId, isDefault: true },
    });
    const profile =
      orgProfile ??
      (await this.prisma.llmProfile.findFirst({
        where: { organizationId: null, isDefault: true },
      }));

    if (!profile) {
      // PRECONDICIÓN OPERATIVA, no error de programación ni petición mal formada: quien
      // llama no puede arreglarlo cambiando la petición, hace falta configurar la IA. Un 500
      // lo presentaría como una avería nuestra y mandaría a investigar a quien no toca.
      //
      // El mensaje va dirigido a una PYME: dice qué hacer y dónde, sin nombrar columnas,
      // clases ni variables de entorno.
      throw new ServiceUnavailableException(
        'La inteligencia artificial todavía no está configurada. Ve a Configuración y añade ' +
          'la clave de tu proveedor de IA para que BusinessBrain pueda leer tus documentos y ' +
          'responder preguntas.',
      );
    }

    return this.usable(profile, organizationId);
  }

  /**
   * Resuelve el perfil con el que responde un agente — §7.3: primero el `LlmProfile` del
   * `Agent` si lo tiene, si no el de la organización.
   *
   * El perfil del agente se vuelve a validar contra la organización aunque `AgentsService`
   * ya lo hiciera al asignarlo: entre aquella escritura y esta lectura, el perfil pudo
   * cambiar de manos. Sin esta comprobación, un `llmProfileId` heredado podría gastar —o
   * exponer— la clave BYO de otro cliente.
   */
  async resolveForAgent(
    organizationId: string,
    llmProfileId: string | null,
  ): Promise<ResolvedLlmProfile> {
    if (!llmProfileId) return this.resolveForOrganization(organizationId);

    const profile = await this.prisma.llmProfile.findFirst({
      where: {
        id: llmProfileId,
        OR: [{ organizationId }, { organizationId: null }],
      },
    });

    // Un perfil que ya no es utilizable degrada al de la organización, no rompe la
    // conversación: el agente sigue pudiendo responder, solo que con el modelo por defecto.
    if (!profile) return this.resolveForOrganization(organizationId);

    return this.usable(profile, organizationId);
  }

  /**
   * Proveedor de EMBEDDINGS utilizable por una organización.
   *
   * Vive aquí y no en quien vectoriza porque es donde se resuelven los perfiles, y porque
   * arrastraba un fallo silencioso: se leía el perfil de la organización —de cualquier
   * proveedor— y se llamaba SIEMPRE al de OpenAI con la clave de ese perfil. Una empresa con
   * Anthropic configurado habría mandado su clave de Anthropic a OpenAI.
   *
   * Si el perfil de la organización no sabe vectorizar, se cae a la clave de PLATAFORMA en vez
   * de usar una clave que no corresponde. Y si tampoco la hay, se dice con claridad: sin
   * vectorizar, lo que entra no se puede preguntar.
   */
  async resolveEmbeddingsForOrganization(organizationId: string): Promise<{
    provider: EmbeddingProviderPort;
    modelName: string;
    apiKey: string | undefined;
  }> {
    const resolved = await this.resolveForOrganization(organizationId);
    const canEmbed = Boolean(
      this.embeddingProviders[resolved.profile.provider],
    );

    return {
      // Hoy solo OpenAI vectoriza. Si el perfil es de otro proveedor, su clave NO sirve aquí.
      provider: this.metered(
        organizationId,
        this.getEmbeddingProvider(LlmProviderName.OPENAI),
      ),
      modelName: resolved.profile.modelName,
      apiKey: canEmbed ? resolved.apiKey : undefined,
    };
  }

  /** Descifra la clave propia, si la hay, y aparta el texto cifrado del resultado. */
  private usable(
    profile: LlmProfile,
    organizationId: string,
  ): ResolvedLlmProfile {
    const { apiKeyEnc, ...visible } = profile;

    return {
      profile: visible,
      provider: this.meteredLlm(
        organizationId,
        this.getLlmProvider(profile.provider),
      ),
      // Sin clave propia se devuelve `undefined`, que es lo que el proveedor interpreta como
      // "usa la de plataforma". Nunca una cadena vacía: parecería una clave y fallaría lejos.
      apiKey: apiKeyEnc ? this.encryption.decrypt(apiKeyEnc) : undefined,
    };
  }

  /**
   * Envuelve al proveedor para que cuente lo que gasta y frene si la empresa se pasa del día.
   *
   * ## Por qué AQUÍ y no en cada sitio que llama al modelo
   *
   * Porque los sitios que llaman al modelo son ocho y mañana serán nueve. Instrumentarlos uno a
   * uno significa que el noveno se olvida —en silencio, y precisamente el que se olvida es el
   * que nadie tenía en la cabeza al poner el tope—. Todo el que llama al modelo pasa antes por
   * este registro; envolviendo aquí, la protección la hereda hasta el código que todavía no
   * está escrito.
   *
   * ## La llamada que cruza el umbral se ejecuta entera
   *
   * A propósito. Cortar una vectorización por la mitad dejaría un documento a medio indexar, y
   * ese estado es peor que unos miles de caracteres de más.
   *
   * ## Lo que se cuenta al terminar y no al empezar
   *
   * Apuntar por adelantado una llamada que luego falla haría pagar —en cupo— por algo que no
   * ocurrió. La contrapartida está en el flujo por fragmentos: si quien consume abandona el
   * hilo a medias, ese gasto no se apunta. Es el caso raro y el error va a favor del cliente.
   */
  private meteredLlm(
    organizationId: string,
    provider: LlmProviderPort,
  ): LlmProviderPort {
    const usage = this.usage;

    return {
      name: provider.name,
      complete: async (request, modelName, apiKey) => {
        await usage.assertWithinBudget(organizationId);
        const result = await provider.complete(request, modelName, apiKey);
        await usage.record(organizationId, charactersOf(request));
        return result;
      },
      stream: async function* (request, modelName, apiKey) {
        await usage.assertWithinBudget(organizationId);
        yield* provider.stream(request, modelName, apiKey);
        await usage.record(organizationId, charactersOf(request));
      },
    };
  }

  private metered(
    organizationId: string,
    provider: EmbeddingProviderPort,
  ): EmbeddingProviderPort {
    const usage = this.usage;

    return {
      name: provider.name,
      embed: async (texts, modelName, apiKey) => {
        await usage.assertWithinBudget(organizationId);
        const vectors = await provider.embed(texts, modelName, apiKey);
        await usage.record(organizationId, charactersInTexts(texts));
        return vectors;
      },
    };
  }
}

/** Todo el texto que viaja: los mensajes y las instrucciones del sistema. */
function charactersOf(request: {
  messages?: { content?: unknown }[];
  systemPrompt?: string;
}): number {
  return (
    charactersInMessages(request.messages) + (request.systemPrompt?.length ?? 0)
  );
}

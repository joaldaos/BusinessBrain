import { Injectable } from '@nestjs/common';
import { LlmProviderName } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AnthropicProvider } from '../infrastructure/providers/anthropic.provider';
import { OpenAiProvider } from '../infrastructure/providers/openai.provider';
import type { LlmProviderPort } from '../domain/ports/llm-provider.port';
import type { EmbeddingProviderPort } from '../domain/ports/embedding-provider.port';

/**
 * Único punto del sistema que sabe qué proveedores concretos existen.
 * Todo consumidor (Conversations, Agents, Knowledge Engine...) pasa por aquí,
 * nunca instancia AnthropicProvider/OpenAiProvider directamente.
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
      throw new Error(
        `Proveedor LLM "${name}" no implementado todavía (soportados: ${Object.keys(this.llmProviders).join(', ')})`,
      );
    }
    return provider;
  }

  getEmbeddingProvider(name: LlmProviderName): EmbeddingProviderPort {
    const provider = this.embeddingProviders[name];
    if (!provider) {
      throw new Error(
        `Proveedor de embeddings "${name}" no implementado todavía (soportados: ${Object.keys(this.embeddingProviders).join(', ')})`,
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
  async resolveForOrganization(organizationId: string) {
    const orgProfile = await this.prisma.llmProfile.findFirst({
      where: { organizationId, isDefault: true },
    });
    const profile =
      orgProfile ??
      (await this.prisma.llmProfile.findFirst({
        where: { organizationId: null, isDefault: true },
      }));

    if (!profile) {
      throw new Error(
        'No hay ningún LlmProfile por defecto configurado (ni de la organización ni de plataforma)',
      );
    }

    return { profile, provider: this.getLlmProvider(profile.provider) };
  }
}

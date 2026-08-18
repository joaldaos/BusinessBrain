import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmProviderName } from '@businessbrain/database';
import {
  HTTP_CLIENT_PORT,
  type HttpClientPort,
} from '../../domain/ports/http-client.port';
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProviderPort,
} from '../../domain/ports/llm-provider.port';
import type { AppConfig } from '../../../config/configuration';

interface AnthropicMessagesResponse {
  model: string;
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}

interface AnthropicStreamEvent {
  type: string;
  delta?: { text?: string };
}

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Solo implementa LlmProviderPort (completions) — Anthropic no expone una API
 * de embeddings pública, a diferencia de OpenAiProvider (ver EmbeddingProviderPort).
 */
@Injectable()
export class AnthropicProvider implements LlmProviderPort {
  readonly name = LlmProviderName.ANTHROPIC;

  constructor(
    @Inject(HTTP_CLIENT_PORT) private readonly http: HttpClientPort,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async complete(
    request: LlmCompletionRequest,
    modelName: string,
    apiKey?: string,
  ): Promise<LlmCompletionResult> {
    const key = this.resolveApiKey(apiKey);

    const response = await this.http.postJson<AnthropicMessagesResponse>(
      ANTHROPIC_MESSAGES_URL,
      {
        model: modelName,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: request.systemPrompt,
        temperature: request.temperature,
        messages: request.messages,
      },
      { 'x-api-key': key, 'anthropic-version': ANTHROPIC_API_VERSION },
    );

    return {
      content: response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join(''),
      model: response.model,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          }
        : undefined,
    };
  }

  /**
   * Formato de Anthropic: el texto llega en eventos `content_block_delta` con
   * `delta.text`. El resto de tipos de evento (arranque de bloque, uso de tokens, fin)
   * no aportan texto y se ignoran.
   */
  async *stream(
    request: LlmCompletionRequest,
    modelName: string,
    apiKey?: string,
  ): AsyncIterable<string> {
    const key = this.resolveApiKey(apiKey);

    const events = this.http.postSse(
      ANTHROPIC_MESSAGES_URL,
      {
        model: modelName,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: request.systemPrompt,
        temperature: request.temperature,
        messages: request.messages,
        stream: true,
      },
      { 'x-api-key': key, 'anthropic-version': ANTHROPIC_API_VERSION },
    );

    for await (const payload of events) {
      const event = JSON.parse(payload) as AnthropicStreamEvent;
      if (event.type === 'content_block_delta' && event.delta?.text) {
        yield event.delta.text;
      }
    }
  }

  private resolveApiKey(apiKey?: string): string {
    const key =
      apiKey ??
      this.configService.get('llmPlatformKeys.anthropic', { infer: true });
    if (!key) {
      throw new Error(
        // Lo lee una PYME cuando falla una sincronización o una pregunta: dice qué hacer y
        // dónde, sin nombrar columnas, clases ni variables de entorno.
        'La inteligencia artificial no está configurada. Ve a Configuración y añade la clave ' +
          'de tu proveedor de IA.',
      );
    }
    return key;
  }
}

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
import type { EmbeddingProviderPort } from '../../domain/ports/embedding-provider.port';
import type { AppConfig } from '../../../config/configuration';
import { externalEndpoint } from '../../../common/utils/external-endpoint';

interface OpenAiChatCompletionResponse {
  model: string;
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

interface OpenAiStreamEvent {
  choices: Array<{ delta?: { content?: string } }>;
}

interface OpenAiEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

/**
 * Redirigibles fuera de produccion. Es lo que permite verificar en un navegador de verdad que
 * una respuesta con citas llega a la pantalla, sin exigir una clave real de OpenAI: sin ello,
 * el chat solo se podria comprobar con dobles inyectados, que sustituyen justamente la parte
 * que se quiere ver funcionando de punta a punta. Ver `externalEndpoint`.
 */
const chatUrl = () =>
  externalEndpoint(
    'https://api.openai.com/v1/chat/completions',
    'OPENAI_CHAT_URL',
  );
const embeddingsUrl = () =>
  externalEndpoint(
    'https://api.openai.com/v1/embeddings',
    'OPENAI_EMBEDDINGS_URL',
  );

/**
 * Implementa AMBOS puertos (LlmProviderPort + EmbeddingProviderPort): a diferencia
 * de Anthropic, OpenAI ofrece tanto chat completions como embeddings.
 */
@Injectable()
export class OpenAiProvider implements LlmProviderPort, EmbeddingProviderPort {
  readonly name = LlmProviderName.OPENAI;

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

    const messages = request.systemPrompt
      ? [{ role: 'system', content: request.systemPrompt }, ...request.messages]
      : request.messages;

    const response = await this.http.postJson<OpenAiChatCompletionResponse>(
      chatUrl(),
      {
        model: modelName,
        messages,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
      },
      { Authorization: `Bearer ${key}` },
    );

    return {
      content: response.choices[0]?.message.content ?? '',
      model: response.model,
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  }

  /**
   * Formato de OpenAI: cada evento trae `choices[0].delta.content` con el incremento, y el
   * literal `[DONE]` cierra el flujo. Un evento sin contenido (el primero, que solo trae el
   * rol) no aporta texto y se ignora.
   */
  async *stream(
    request: LlmCompletionRequest,
    modelName: string,
    apiKey?: string,
  ): AsyncIterable<string> {
    const key = this.resolveApiKey(apiKey);

    const messages = request.systemPrompt
      ? [{ role: 'system', content: request.systemPrompt }, ...request.messages]
      : request.messages;

    const events = this.http.postSse(
      chatUrl(),
      {
        model: modelName,
        messages,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        stream: true,
      },
      { Authorization: `Bearer ${key}` },
    );

    for await (const payload of events) {
      if (payload === '[DONE]') return;

      const delta = (JSON.parse(payload) as OpenAiStreamEvent).choices[0]?.delta
        ?.content;
      if (delta) yield delta;
    }
  }

  async embed(
    texts: string[],
    modelName: string,
    apiKey?: string,
  ): Promise<number[][]> {
    const key = this.resolveApiKey(apiKey);

    const response = await this.http.postJson<OpenAiEmbeddingResponse>(
      embeddingsUrl(),
      { model: modelName, input: texts },
      { Authorization: `Bearer ${key}` },
    );

    return response.data.map((item) => item.embedding);
  }

  private resolveApiKey(apiKey?: string): string {
    const key =
      apiKey ??
      this.configService.get('llmPlatformKeys.openai', { infer: true });
    if (!key) {
      throw new Error(
        'No hay API key de OpenAI disponible (ni LlmProfile.apiKeyEnc de la organización ni OPENAI_API_KEY de plataforma)',
      );
    }
    return key;
  }
}

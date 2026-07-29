import type { LlmProviderName } from '@businessbrain/database';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionRequest {
  systemPrompt?: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface LlmCompletionResult {
  content: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Puerto que cualquier proveedor de LLM conversacional debe implementar.
 * `ProviderRegistry` decide en runtime qué implementación usar según
 * `LlmProfile` — ningún consumidor (Conversations, Agents...) conoce
 * Anthropic/OpenAI/etc. directamente, solo este puerto.
 */
export interface LlmProviderPort {
  readonly name: LlmProviderName;
  complete(
    request: LlmCompletionRequest,
    modelName: string,
    apiKey?: string,
  ): Promise<LlmCompletionResult>;

  /**
   * Misma petición que `complete`, entregada por fragmentos según los genera el modelo.
   *
   * Emite únicamente los incrementos de texto, nunca el acumulado: quien consume decide
   * si concatena. El resultado completo debe ser idéntico a concatenar todo lo emitido,
   * de modo que lo que se persiste al terminar es lo mismo que habría devuelto `complete`.
   */
  stream(
    request: LlmCompletionRequest,
    modelName: string,
    apiKey?: string,
  ): AsyncIterable<string>;
}

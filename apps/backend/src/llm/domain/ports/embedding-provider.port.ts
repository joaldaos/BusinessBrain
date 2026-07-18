import type { LlmProviderName } from '@businessbrain/database';

/**
 * Puerto de generación de embeddings. Deliberadamente separado de LlmProviderPort:
 * no todo proveedor conversacional ofrece embeddings (Anthropic, por ejemplo, no
 * expone una API de embeddings), así que un proveedor puede implementar uno,
 * el otro, o ambos.
 */
export interface EmbeddingProviderPort {
  readonly name: LlmProviderName;
  embed(
    texts: string[],
    modelName: string,
    apiKey?: string,
  ): Promise<number[][]>;
}

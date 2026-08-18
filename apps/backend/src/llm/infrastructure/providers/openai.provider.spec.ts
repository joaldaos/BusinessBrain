import { OpenAiProvider } from './openai.provider';
import type { HttpClientPort } from '../../domain/ports/http-client.port';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../config/configuration';

/**
 * El proveedor exige `ConfigService<AppConfig, true>` (inferencia activada). Un doble tipado
 * como `ConfigService` a secas resuelve a `ConfigService<Record<string|symbol, unknown>,
 * false>` y NO es asignable: era el origen de los 5 errores de typecheck que el gate no veia
 * porque `tsconfig.build.json` excluye los specs.
 */
type TypedConfigService = ConfigService<AppConfig, true>;

describe('OpenAiProvider', () => {
  const fakeHttp: jest.Mocked<HttpClientPort> = {
    postJson: jest.fn(),
    postSse: jest.fn(),
  };
  const fakeConfig = {
    get: jest.fn().mockReturnValue('sk-openai-fake-key'),
  } as unknown as TypedConfigService;
  const provider = new OpenAiProvider(fakeHttp, fakeConfig);

  beforeEach(() => jest.clearAllMocks());

  it('normaliza la respuesta de OpenAI al MISMO contrato LlmCompletionResult que AnthropicProvider', async () => {
    fakeHttp.postJson.mockResolvedValue({
      model: 'gpt-4.1',
      choices: [{ message: { content: 'Hola desde GPT' } }],
      usage: { prompt_tokens: 12, completion_tokens: 6 },
    });

    const result = await provider.complete(
      { messages: [{ role: 'user', content: 'hola' }] },
      'gpt-4.1',
    );

    expect(result).toEqual({
      content: 'Hola desde GPT',
      model: 'gpt-4.1',
      usage: { inputTokens: 12, outputTokens: 6 },
    });
  });

  it('antepone el system prompt como mensaje "system" (formato propio de la API de OpenAI)', async () => {
    fakeHttp.postJson.mockResolvedValue({
      model: 'gpt-4.1',
      choices: [{ message: { content: '' } }],
    });

    await provider.complete(
      {
        systemPrompt: 'Eres un agente de soporte',
        messages: [{ role: 'user', content: 'hola' }],
      },
      'gpt-4.1',
    );

    expect(fakeHttp.postJson).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        messages: [
          { role: 'system', content: 'Eres un agente de soporte' },
          { role: 'user', content: 'hola' },
        ],
      }),
      expect.objectContaining({ Authorization: 'Bearer sk-openai-fake-key' }),
    );
  });

  it('embed() implementa EmbeddingProviderPort, algo que AnthropicProvider no ofrece', async () => {
    fakeHttp.postJson.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
    });

    const vectors = await provider.embed(
      ['texto uno', 'texto dos'],
      'text-embedding-3-small',
    );

    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(fakeHttp.postJson).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      { model: 'text-embedding-3-small', input: ['texto uno', 'texto dos'] },
      expect.objectContaining({ Authorization: expect.any(String) }),
    );
  });

  it('sin clave, el mensaje lo entiende una PYME y no nombra nada técnico', async () => {
    // Lo lee alguien cuando falla una sincronización o una pregunta: tiene que decir qué
    // hacer y dónde, no el nombre de una columna ni de una variable de entorno.
    const configWithoutKey = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as TypedConfigService;
    const providerWithoutKey = new OpenAiProvider(fakeHttp, configWithoutKey);

    await expect(
      providerWithoutKey.complete({ messages: [] }, 'gpt-4.1'),
    ).rejects.toThrow(/no está configurada/i);
    await expect(
      providerWithoutKey.complete({ messages: [] }, 'gpt-4.1'),
    ).rejects.not.toThrow(/LlmProfile|apiKeyEnc|OPENAI_API_KEY/);
  });

  /** Consume un flujo entero cuando lo que se verifica es la llamada, no lo emitido. */
  const drain = async (stream: AsyncIterable<string>): Promise<void> => {
    for await (const chunk of stream) void chunk;
  };

  describe('stream', () => {
    const events = async function* (payloads: string[]): AsyncIterable<string> {
      for (const payload of payloads) yield await Promise.resolve(payload);
    };

    it('emite solo los INCREMENTOS de texto, nunca el acumulado', async () => {
      fakeHttp.postSse.mockReturnValue(
        events([
          JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] }),
          JSON.stringify({ choices: [{ delta: { content: 'Hola' } }] }),
          JSON.stringify({ choices: [{ delta: { content: ' mundo' } }] }),
          '[DONE]',
        ]),
      );

      const chunks: string[] = [];
      for await (const chunk of provider.stream(
        { messages: [{ role: 'user', content: 'hola' }] },
        'gpt-4.1',
      )) {
        chunks.push(chunk);
      }

      // Concatenar lo emitido debe dar la misma respuesta que habría devuelto complete().
      expect(chunks).toEqual(['Hola', ' mundo']);
      expect(chunks.join('')).toBe('Hola mundo');
    });

    it('cierra el flujo al recibir [DONE] sin emitirlo como texto', async () => {
      fakeHttp.postSse.mockReturnValue(
        events([
          JSON.stringify({ choices: [{ delta: { content: 'a' } }] }),
          '[DONE]',
          JSON.stringify({
            choices: [{ delta: { content: 'no debería llegar' } }],
          }),
        ]),
      );

      const chunks: string[] = [];
      for await (const chunk of provider.stream({ messages: [] }, 'gpt-4.1')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['a']);
    });

    it('pide el stream a la API y antepone el system prompt igual que complete()', async () => {
      fakeHttp.postSse.mockReturnValue(events(['[DONE]']));

      await drain(
        provider.stream(
          {
            systemPrompt: 'eres útil',
            messages: [{ role: 'user', content: 'hola' }],
          },
          'gpt-4.1',
        ),
      );

      expect(fakeHttp.postSse).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          stream: true,
          messages: [
            { role: 'system', content: 'eres útil' },
            { role: 'user', content: 'hola' },
          ],
        }),
        expect.any(Object),
      );
    });
  });
});

import { OpenAiProvider } from './openai.provider';
import type { HttpClientPort } from '../../domain/ports/http-client.port';
import type { ConfigService } from '@nestjs/config';

describe('OpenAiProvider', () => {
  const fakeHttp: jest.Mocked<HttpClientPort> = { postJson: jest.fn() };
  const fakeConfig = {
    get: jest.fn().mockReturnValue('sk-openai-fake-key'),
  } as unknown as ConfigService;
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

  it('lanza un error claro si no hay API key disponible', async () => {
    const configWithoutKey = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const providerWithoutKey = new OpenAiProvider(fakeHttp, configWithoutKey);

    await expect(
      providerWithoutKey.complete({ messages: [] }, 'gpt-4.1'),
    ).rejects.toThrow(/API key/);
  });
});

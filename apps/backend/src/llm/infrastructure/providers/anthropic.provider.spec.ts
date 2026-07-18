import { AnthropicProvider } from './anthropic.provider';
import type { HttpClientPort } from '../../domain/ports/http-client.port';
import type { ConfigService } from '@nestjs/config';

describe('AnthropicProvider', () => {
  const fakeHttp: jest.Mocked<HttpClientPort> = { postJson: jest.fn() };
  const fakeConfig = {
    get: jest.fn().mockReturnValue('sk-ant-fake-key'),
  } as unknown as ConfigService;
  const provider = new AnthropicProvider(fakeHttp, fakeConfig);

  beforeEach(() => jest.clearAllMocks());

  it('normaliza la respuesta de Anthropic al contrato común LlmCompletionResult', async () => {
    fakeHttp.postJson.mockResolvedValue({
      model: 'claude-sonnet-5',
      content: [{ type: 'text', text: 'Hola desde Claude' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const result = await provider.complete(
      { messages: [{ role: 'user', content: 'hola' }] },
      'claude-sonnet-5',
    );

    expect(result).toEqual({
      content: 'Hola desde Claude',
      model: 'claude-sonnet-5',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it('lanza un error claro si no hay API key disponible', async () => {
    const configWithoutKey = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const providerWithoutKey = new AnthropicProvider(
      fakeHttp,
      configWithoutKey,
    );

    await expect(
      providerWithoutKey.complete({ messages: [] }, 'claude-sonnet-5'),
    ).rejects.toThrow(/API key/);
  });

  it('envía el system prompt y los headers de autenticación esperados por la API de Anthropic', async () => {
    fakeHttp.postJson.mockResolvedValue({
      model: 'claude-sonnet-5',
      content: [],
    });

    await provider.complete(
      {
        systemPrompt: 'Eres un agente de ventas',
        messages: [{ role: 'user', content: 'hola' }],
      },
      'claude-sonnet-5',
    );

    expect(fakeHttp.postJson).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        system: 'Eres un agente de ventas',
        model: 'claude-sonnet-5',
      }),
      expect.objectContaining({
        'x-api-key': 'sk-ant-fake-key',
        'anthropic-version': '2023-06-01',
      }),
    );
  });
});

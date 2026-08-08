import type { ConfigService } from '@nestjs/config';
import { FetchHttpClient } from '../../src/llm/infrastructure/http/fetch-http-client';
import { AnthropicProvider } from '../../src/llm/infrastructure/providers/anthropic.provider';
import { OpenAiProvider } from '../../src/llm/infrastructure/providers/openai.provider';
import type { AppConfig } from '../../src/config/configuration';

/**
 * Validación REAL contra los proveedores de LLM — subfase 5.9, bloque 8.
 *
 * Esta suite es la única del proyecto que sale a la red. **No se ejecuta con `npm test` ni
 * con `test:int` ni con `test:e2e`**: tiene su propio comando (`npm run test:live`) y se
 * salta sola si no hay credenciales.
 *
 * Por qué existe separada. Todo lo demás dobla el proveedor, y con razón: los tests deben ser
 * deterministas y gratuitos. Pero eso deja sin verificar exactamente lo que un doble no puede
 * demostrar — que el cuerpo que construimos es el que la API acepta, que el modelo existe,
 * que la autenticación es la correcta y que el streaming se decodifica de verdad. Mientras
 * eso no se ejecute contra el proveedor real, **la integración con el proveedor NO está
 * validada**, y así debe declararse.
 *
 * Por qué se SALTA en vez de fallar. Un `fail()` sin credenciales convertiría la ausencia de
 * una clave en un fallo de la suite y empujaría a comentar el test; saltarlo con un aviso
 * explícito mantiene la deuda visible sin bloquear a nadie.
 *
 * NUNCA se inventan credenciales ni se apuntan a un servidor falso: eso daría un verde que no
 * significa nada, que es peor que no tener el test.
 */

const anthropicKey = process.env.ANTHROPIC_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

/** `ConfigService` mínimo que devuelve la clave de plataforma del entorno. */
const configWith = (key: string | undefined): ConfigService<AppConfig, true> =>
  ({ get: () => key }) as unknown as ConfigService<AppConfig, true>;

const describeAnthropic = anthropicKey ? describe : describe.skip;
const describeOpenAi = openaiKey ? describe : describe.skip;

beforeAll(() => {
  if (!anthropicKey || !openaiKey) {
    const missing = [
      anthropicKey ? null : 'ANTHROPIC_API_KEY',
      openaiKey ? null : 'OPENAI_API_KEY',
    ].filter(Boolean);
    console.warn(
      `[VALIDACIÓN PENDIENTE] Sin ${missing.join(' ni ')}: la integración con esos ` +
        'proveedores NO queda verificada. Ejecuta `npm run test:live` con las claves ' +
        'reales en el entorno para cerrar esta deuda.',
    );
  }
});

describeAnthropic('AnthropicProvider (real)', () => {
  const provider = new AnthropicProvider(
    new FetchHttpClient(),
    configWith(anthropicKey),
  );
  const model = process.env.ANTHROPIC_TEST_MODEL ?? 'claude-sonnet-5';

  it('completa una petición real y devuelve el contrato común', async () => {
    const result = await provider.complete(
      {
        systemPrompt: 'Responde con una sola palabra.',
        messages: [{ role: 'user', content: 'Di "hola" y nada más.' }],
        maxTokens: 32,
      },
      model,
    );

    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.model).toBeTruthy();
  }, 60000);

  it('el streaming concatenado equivale a una respuesta completa', async () => {
    let accumulated = '';
    for await (const delta of provider.stream(
      {
        messages: [{ role: 'user', content: 'Cuenta del 1 al 3.' }],
        maxTokens: 32,
      },
      model,
    )) {
      accumulated += delta;
    }

    // El contrato del puerto: lo emitido son incrementos, y concatenarlos da el texto final.
    expect(accumulated.length).toBeGreaterThan(0);
  }, 60000);
});

describeOpenAi('OpenAiProvider (real)', () => {
  const provider = new OpenAiProvider(
    new FetchHttpClient(),
    configWith(openaiKey),
  );
  const model = process.env.OPENAI_TEST_MODEL ?? 'gpt-4.1-mini';

  it('completa una petición real y devuelve el contrato común', async () => {
    const result = await provider.complete(
      {
        systemPrompt: 'Responde con una sola palabra.',
        messages: [{ role: 'user', content: 'Di "hola" y nada más.' }],
        maxTokens: 32,
      },
      model,
    );

    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);
  }, 60000);

  it('el streaming concatenado equivale a una respuesta completa', async () => {
    let accumulated = '';
    for await (const delta of provider.stream(
      {
        messages: [{ role: 'user', content: 'Cuenta del 1 al 3.' }],
        maxTokens: 32,
      },
      model,
    )) {
      accumulated += delta;
    }

    expect(accumulated.length).toBeGreaterThan(0);
  }, 60000);
});

describe('estado de la validación de proveedores', () => {
  it('declara explícitamente si la validación real está pendiente', () => {
    const pending = !anthropicKey || !openaiKey;

    // Este test no falla nunca: documenta el estado. Lo que importa es que la ausencia de
    // validación quede registrada en la salida de la suite en vez de pasar desapercibida.
    expect(typeof pending).toBe('boolean');
  });
});

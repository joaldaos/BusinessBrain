import { ProviderRegistry } from './provider-registry.service';
import { AnthropicProvider } from '../infrastructure/providers/anthropic.provider';
import { OpenAiProvider } from '../infrastructure/providers/openai.provider';
import type { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/utils/encryption.util';
import type { AiUsageService } from './ai-usage.service';

describe('ProviderRegistry', () => {
  const anthropicProvider = {
    name: 'ANTHROPIC',
  } as unknown as AnthropicProvider;
  const openAiProvider = { name: 'OPENAI' } as unknown as OpenAiProvider;
  let prisma: { llmProfile: { findFirst: jest.Mock } };
  const encryption = new EncryptionService({
    get: () => Buffer.alloc(32, 7).toString('base64'),
  } as unknown as ConstructorParameters<typeof EncryptionService>[0]);
  let registry: ProviderRegistry;

  beforeEach(() => {
    prisma = { llmProfile: { findFirst: jest.fn() } };
    // Cifrado REAL, no un doble: el registro es el unico punto que descifra una clave de IA,
    // y doblarlo dejaria sin verificar justamente ese ida y vuelta.
    registry = new ProviderRegistry(
      prisma as unknown as PrismaService,
      encryption,
      // El contador de uso se dobla: estos tests van de resolución de perfiles y descifrado.
      // Que el tope se aplique de verdad lo comprueba `ai-budget` y la suite HTTP.
      {
        assertWithinBudget: jest.fn().mockResolvedValue(undefined),
        record: jest.fn().mockResolvedValue(undefined),
      } as unknown as AiUsageService,
      anthropicProvider,
      openAiProvider,
    );
  });

  it('lanza un error legible para un proveedor del enum aún sin implementar (GEMINI/MISTRAL/OLLAMA)', () => {
    expect(() => registry.getLlmProvider('GEMINI')).toThrow(
      /no implementa todavía/,
    );

    // 6.4: es una PRECONDICIÓN OPERATIVA, no una avería. Un 500 mandaría a investigar a
    // quien no puede arreglarlo; un 503 dice que falta configurar algo.
    expect(() => registry.getLlmProvider('GEMINI')).toThrow(
      expect.objectContaining({ status: 503 }),
    );
  });

  it('devuelve el mismo puerto LlmProviderPort sea cual sea el proveedor pedido', () => {
    expect(registry.getLlmProvider('ANTHROPIC')).toBe(anthropicProvider);
    expect(registry.getLlmProvider('OPENAI')).toBe(openAiProvider);
  });

  describe('resolveForOrganization — selección puramente por configuración', () => {
    it('usa el LlmProfile propio de la organización si existe', async () => {
      prisma.llmProfile.findFirst.mockResolvedValueOnce({
        id: 'profile-org',
        provider: 'OPENAI',
        organizationId: 'org-1',
      });

      const { provider, profile } =
        await registry.resolveForOrganization('org-1');

      expect(provider.name).toBe(openAiProvider.name);
      expect(profile.id).toBe('profile-org');
    });

    it('cae al LlmProfile de plataforma si la organización no tiene uno propio', async () => {
      prisma.llmProfile.findFirst
        .mockResolvedValueOnce(null) // sin perfil propio de la organización
        .mockResolvedValueOnce({
          id: 'profile-platform',
          provider: 'ANTHROPIC',
          organizationId: null,
        });

      const { provider, profile } =
        await registry.resolveForOrganization('org-sin-perfil');

      expect(provider.name).toBe(anthropicProvider.name);
      expect(profile.id).toBe('profile-platform');
    });

    it('cambiar de proveedor para una organización es solo una fila distinta en LlmProfile, no un redeploy', async () => {
      prisma.llmProfile.findFirst.mockResolvedValueOnce({
        id: 'p1',
        provider: 'ANTHROPIC',
        organizationId: 'org-1',
      });
      const first = await registry.resolveForOrganization('org-1');
      expect(first.provider.name).toBe(anthropicProvider.name);

      prisma.llmProfile.findFirst.mockResolvedValueOnce({
        id: 'p1',
        provider: 'OPENAI',
        organizationId: 'org-1',
      });
      const second = await registry.resolveForOrganization('org-1');
      expect(second.provider.name).toBe(openAiProvider.name);
    });

    it('lanza un error claro si no hay ningún perfil configurado ni de organización ni de plataforma', async () => {
      prisma.llmProfile.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      await expect(registry.resolveForOrganization('org-1')).rejects.toThrow(
        /no está configurada/,
      );
      await expect(
        registry.resolveForOrganization('org-1'),
      ).rejects.toMatchObject({ status: 503 });
    });

    it('CRÍTICO: entrega la clave DESCIFRADA, no el texto cifrado', async () => {
      // Seis consumidores pasaban `profile.apiKeyEnc` como si fuera la clave, y nadie la
      // desciframos en ningún punto. No se notaba porque no había forma de crear un perfil:
      // la columna siempre estaba vacía y todo caía a la clave de plataforma. En cuanto una
      // empresa guarda la suya, esas rutas mandarían el cifrado al proveedor.
      const cifrada = encryption.encrypt('sk-la-clave-de-la-empresa');
      expect(cifrada).not.toContain('sk-la-clave-de-la-empresa');
      prisma.llmProfile.findFirst.mockResolvedValueOnce({
        id: 'perfil-1',
        organizationId: 'org-1',
        provider: 'OPENAI',
        modelName: 'gpt-4.1',
        apiKeyEnc: cifrada,
        isDefault: true,
      });

      const resuelto = await registry.resolveForOrganization('org-1');

      expect(resuelto.apiKey).toBe('sk-la-clave-de-la-empresa');
      // Y el texto cifrado NO viaja con el perfil: quien consume no puede volver a
      // equivocarse porque ya no lo tiene en la mano.
      expect(resuelto.profile).not.toHaveProperty('apiKeyEnc');
    });

    it('sin clave propia devuelve undefined, que significa "usa la de plataforma"', async () => {
      prisma.llmProfile.findFirst.mockResolvedValueOnce({
        id: 'perfil-plataforma',
        organizationId: null,
        provider: 'OPENAI',
        modelName: 'gpt-4.1',
        apiKeyEnc: null,
        isDefault: true,
      });

      // Nunca una cadena vacía: parecería una clave y fallaría lejos de aquí.
      expect(
        (await registry.resolveForOrganization('org-1')).apiKey,
      ).toBeUndefined();
    });
  });

  describe('resolveEmbeddingsForOrganization', () => {
    it('CRÍTICO: NO manda la clave de un proveedor a otro', async () => {
      // Vectorizar solo lo hace OpenAI. Antes se leía el perfil de la organización —fuera del
      // proveedor que fuera— y se llamaba a OpenAI con esa clave: una empresa con Anthropic
      // configurado habría mandado su clave de Anthropic a OpenAI.
      prisma.llmProfile.findFirst.mockResolvedValueOnce({
        id: 'perfil-anthropic',
        organizationId: 'org-1',
        provider: 'ANTHROPIC',
        modelName: 'claude-sonnet-5',
        apiKeyEnc: encryption.encrypt('sk-ant-de-la-empresa'),
        isDefault: true,
      });

      const resuelto = await registry.resolveEmbeddingsForOrganization('org-1');

      expect(resuelto.provider.name).toBe(openAiProvider.name);
      // Se cae a la de plataforma en vez de usar una clave que no corresponde.
      expect(resuelto.apiKey).toBeUndefined();
    });

    it('con OpenAI configurado sí usa la clave de la empresa', async () => {
      prisma.llmProfile.findFirst.mockResolvedValueOnce({
        id: 'perfil-openai',
        organizationId: 'org-1',
        provider: 'OPENAI',
        modelName: 'gpt-4.1',
        apiKeyEnc: encryption.encrypt('sk-de-la-empresa'),
        isDefault: true,
      });

      expect(
        (await registry.resolveEmbeddingsForOrganization('org-1')).apiKey,
      ).toBe('sk-de-la-empresa');
    });
  });
});

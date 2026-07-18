import { ProviderRegistry } from './provider-registry.service';
import { AnthropicProvider } from '../infrastructure/providers/anthropic.provider';
import { OpenAiProvider } from '../infrastructure/providers/openai.provider';
import type { PrismaService } from '../../prisma/prisma.service';

describe('ProviderRegistry', () => {
  const anthropicProvider = {
    name: 'ANTHROPIC',
  } as unknown as AnthropicProvider;
  const openAiProvider = { name: 'OPENAI' } as unknown as OpenAiProvider;
  let prisma: { llmProfile: { findFirst: jest.Mock } };
  let registry: ProviderRegistry;

  beforeEach(() => {
    prisma = { llmProfile: { findFirst: jest.fn() } };
    registry = new ProviderRegistry(
      prisma as unknown as PrismaService,
      anthropicProvider,
      openAiProvider,
    );
  });

  it('lanza un error legible para un proveedor del enum aún sin implementar (GEMINI/MISTRAL/OLLAMA)', () => {
    expect(() => registry.getLlmProvider('GEMINI')).toThrow(
      /no implementado todavía/,
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

      expect(provider).toBe(openAiProvider);
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

      expect(provider).toBe(anthropicProvider);
      expect(profile.id).toBe('profile-platform');
    });

    it('cambiar de proveedor para una organización es solo una fila distinta en LlmProfile, no un redeploy', async () => {
      prisma.llmProfile.findFirst.mockResolvedValueOnce({
        id: 'p1',
        provider: 'ANTHROPIC',
        organizationId: 'org-1',
      });
      const first = await registry.resolveForOrganization('org-1');
      expect(first.provider).toBe(anthropicProvider);

      prisma.llmProfile.findFirst.mockResolvedValueOnce({
        id: 'p1',
        provider: 'OPENAI',
        organizationId: 'org-1',
      });
      const second = await registry.resolveForOrganization('org-1');
      expect(second.provider).toBe(openAiProvider);
    });

    it('lanza un error claro si no hay ningún perfil configurado ni de organización ni de plataforma', async () => {
      prisma.llmProfile.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      await expect(registry.resolveForOrganization('org-1')).rejects.toThrow(
        /ningún LlmProfile/,
      );
    });
  });
});

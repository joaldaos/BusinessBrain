import { ConfigService } from '@nestjs/config';
import { AiConfigurationService } from '../../src/llm/application/ai-configuration.service';
import { ProviderRegistry } from '../../src/llm/application/provider-registry.service';
import { AiUsageService } from '../../src/llm/application/ai-usage.service';
import type { AnthropicProvider } from '../../src/llm/infrastructure/providers/anthropic.provider';
import type { OpenAiProvider } from '../../src/llm/infrastructure/providers/openai.provider';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  auditService,
  createTestOrg,
  destroyTestOrg,
  encryptionService,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * La configuración de IA contra Postgres real.
 *
 * ## Qué se verifica aquí y no en los unitarios
 *
 * Que la clave hace el viaje ENTERO: se cifra al guardar, queda cifrada en la base de datos, y
 * vuelve utilizable cuando el sistema la necesita. Ese ida y vuelta es exactamente donde estaba
 * el fallo que arrastraba el proyecto: seis consumidores pasaban el texto cifrado como si fuera
 * la clave y nadie lo desciframos nunca. No se notaba porque no existía forma de crear un
 * perfil, así que la columna siempre estaba vacía.
 */
describe('Configuración de IA (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let service: AiConfigurationService;
  let registry: ProviderRegistry;
  let embed: jest.Mock;
  let platformKeys: { openai?: string };

  beforeEach(async () => {
    org = await createTestOrg('config-ia');
    embed = jest.fn().mockResolvedValue([new Array(1536).fill(0.05)]);
    platformKeys = {};

    const openAi = { name: 'OPENAI', embed } as unknown as OpenAiProvider;
    registry = new ProviderRegistry(
      db,
      encryptionService(),
      // Contador REAL sobre el Postgres de pruebas: el tope diario se aplica dentro del
      // registro, y doblarlo dejaría sin ejecutar el camino que frena el gasto.
      new AiUsageService(db),
      { name: 'ANTHROPIC' } as unknown as AnthropicProvider,
      openAi,
    );
    service = new AiConfigurationService(
      db,
      encryptionService(),
      registry,
      auditService(db),
      { get: () => platformKeys } as unknown as ConfigService<never, true>,
    );
  });

  afterEach(async () => {
    // Los perfiles de plataforma no cuelgan de ninguna organización: no los arrastra la
    // cascada y hay que retirarlos a mano.
    await prisma.llmProfile.deleteMany({ where: { organizationId: null } });
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const configure = (apiKey = 'sk-clave-de-la-empresa') =>
    service.configure({
      organizationId: org.orgId,
      actorUserId: org.userId,
      provider: 'OPENAI',
      apiKey,
    });

  it('CRÍTICO: la clave queda CIFRADA en la base de datos', async () => {
    await configure();

    const stored = await prisma.llmProfile.findFirstOrThrow({
      where: { organizationId: org.orgId },
    });

    expect(stored.apiKeyEnc).not.toBeNull();
    expect(stored.apiKeyEnc).not.toContain('sk-clave-de-la-empresa');
    expect(stored.isDefault).toBe(true);
    expect(stored.modelName).toBe('gpt-4.1-mini');
  });

  it('CRÍTICO: el sistema la recupera USABLE, no cifrada', async () => {
    await configure();

    const resuelto = await registry.resolveForOrganization(org.orgId);

    // Es la garantía que faltaba: si se devolviera el cifrado, cada llamada al proveedor
    // fallaría con un error de autenticación que nadie sabría interpretar.
    expect(resuelto.apiKey).toBe('sk-clave-de-la-empresa');
    expect(resuelto.profile).not.toHaveProperty('apiKeyEnc');
  });

  it('vectorizar usa la clave DE LA EMPRESA', async () => {
    await configure();

    const embeddings = await registry.resolveEmbeddingsForOrganization(
      org.orgId,
    );

    expect(embeddings.apiKey).toBe('sk-clave-de-la-empresa');
  });

  it('reconfigurar deja UN solo perfil', async () => {
    await configure('sk-primera');
    await configure('sk-segunda');

    const perfiles = await prisma.llmProfile.findMany({
      where: { organizationId: org.orgId },
    });
    expect(perfiles).toHaveLength(1);
    expect((await registry.resolveForOrganization(org.orgId)).apiKey).toBe(
      'sk-segunda',
    );
  });

  it('una clave rechazada NO deja rastro en la base de datos', async () => {
    embed.mockRejectedValue(new Error('401 invalid_api_key'));

    await expect(configure('sk-mala')).rejects.toThrow(/copiado entera/i);

    expect(
      await prisma.llmProfile.count({ where: { organizationId: org.orgId } }),
    ).toBe(0);
  });

  it('quitar la clave devuelve a la IA incluida en el servicio', async () => {
    await configure();
    await prisma.llmProfile.create({
      data: {
        organizationId: null,
        provider: 'OPENAI',
        modelName: 'gpt-4.1-mini',
        isDefault: true,
      },
    });
    platformKeys = { openai: 'sk-de-la-plataforma' };

    const estado = await service.removeOwnKey({
      organizationId: org.orgId,
      actorUserId: org.userId,
    });

    expect(estado).toMatchObject({ origin: 'PLATAFORMA', ready: true });
    // Y el sistema pasa a usar la de plataforma, no una clave vacía.
    expect(
      (await registry.resolveForOrganization(org.orgId)).apiKey,
    ).toBeUndefined();
  });

  it('CRÍTICO: la clave de una empresa no la alcanza otra', async () => {
    await configure('sk-solo-mia');
    const vecina = await createTestOrg('config-ia-vecina');

    // Sin perfil propio ni de plataforma, la vecina no obtiene NADA — y desde luego no la
    // clave ajena.
    await expect(registry.resolveForOrganization(vecina.orgId)).rejects.toThrow(
      /no está configurada/i,
    );

    expect(await service.status(vecina.orgId)).toMatchObject({
      ready: false,
      hasOwnKey: false,
    });

    await destroyTestOrg(vecina);
  });

  it('queda traza de quién configuró la IA, sin la clave', async () => {
    await configure('sk-secretisima');

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: org.orgId, action: 'ai.configured' },
    });

    expect(log.actorId).toBe(org.userId);
    expect(JSON.stringify(log.metadata)).not.toContain('sk-secretisima');
    expect(log.metadata).toMatchObject({ provider: 'OPENAI' });
  });
});

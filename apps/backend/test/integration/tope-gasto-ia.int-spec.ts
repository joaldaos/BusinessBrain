import { ForbiddenException } from '@nestjs/common';
import { AiUsageService } from '../../src/llm/application/ai-usage.service';
import { ProviderRegistry } from '../../src/llm/application/provider-registry.service';
import { AI_CHARACTERS_METRIC } from '../../src/llm/domain/ai-budget';
import { OrganizationsService } from '../../src/organizations/organizations.service';
import type { AnthropicProvider } from '../../src/llm/infrastructure/providers/anthropic.provider';
import type { OpenAiProvider } from '../../src/llm/infrastructure/providers/openai.provider';
import {
  createTestOrg,
  destroyTestOrg,
  encryptionService,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * El tope de gasto en IA, contra Postgres real.
 *
 * ## Qué protege
 *
 * De que un cliente se lleve un susto con SU factura. El caso real no es un atacante: es
 * alguien que sube su carpeta entera "a ver qué pasa", o una automatización que analiza en
 * bucle. La clave es suya y el cargo le llega a él.
 *
 * ## Por qué se prueba a través del REGISTRO y no del servicio de uso
 *
 * Porque el enganche es lo que puede romperse. Un contador perfecto que nadie consulta no
 * frena nada — y el registro es el único sitio por el que pasan las ocho llamadas al modelo
 * que existen hoy, incluida la que alguien escriba mañana.
 */
describe('Tope de gasto en IA', () => {
  let org: TestOrg;
  let registry: ProviderRegistry;
  let complete: jest.Mock;
  let embed: jest.Mock;

  const db = prisma as unknown as ConstructorParameters<
    typeof ProviderRegistry
  >[0];

  beforeEach(async () => {
    org = await createTestOrg('tope-ia');

    complete = jest
      .fn()
      .mockResolvedValue({ content: 'respuesta', model: 'de-prueba' });
    embed = jest.fn().mockResolvedValue([new Array(1536).fill(0)]);

    registry = new ProviderRegistry(
      db,
      encryptionService(),
      new AiUsageService(db),
      { name: 'ANTHROPIC', complete } as unknown as AnthropicProvider,
      { name: 'OPENAI', complete, embed } as unknown as OpenAiProvider,
    );

    await prisma.llmProfile.create({
      data: {
        organizationId: org.orgId,
        provider: 'OPENAI',
        modelName: 'de-prueba',
        isDefault: true,
      },
    });
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  const preguntar = async (texto: string) => {
    const { provider, profile, apiKey } = await registry.resolveForOrganization(
      org.orgId,
    );
    return provider.complete(
      { messages: [{ role: 'user', content: texto }] },
      profile.modelName,
      apiKey,
    );
  };

  const usoDeHoy = async () => {
    const fila = await prisma.usageRecord.findFirst({
      where: { organizationId: org.orgId, metric: AI_CHARACTERS_METRIC },
    });
    return fila?.value ?? 0;
  };

  const ponerTecho = (limite: number) =>
    prisma.organization.update({
      where: { id: org.orgId },
      data: { settings: { ai: { dailyCharacterLimit: limite } } },
    });

  it('apunta lo que se manda al modelo', async () => {
    await preguntar('doce chars');

    await expect(usoDeHoy()).resolves.toBe('doce chars'.length);
  });

  it('apunta lo que se vectoriza, que es lo que más gasta', async () => {
    const { provider, modelName, apiKey } =
      await registry.resolveEmbeddingsForOrganization(org.orgId);
    await provider.embed(['abcde', 'fg'], modelName, apiKey);

    await expect(usoDeHoy()).resolves.toBe(7);
  });

  it('se acumula a lo largo del día', async () => {
    // Sin acumulación, el tope no serviría de nada: cada llamada empezaría de cero.
    await preguntar('aaaa');
    await preguntar('bb');

    await expect(usoDeHoy()).resolves.toBe(6);
  });

  it('CRÍTICO: al llegar al techo se frena', async () => {
    await ponerTecho(10);
    await preguntar('aaaaaaaaaaaa'); // 12 caracteres: cruza el umbral

    await expect(preguntar('otra vez')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('CRÍTICO: al frenar, NO se llama al proveedor', async () => {
    // Es la diferencia entre un tope y un informe: si la llamada saliera igual, el cliente ya
    // habría pagado.
    await ponerTecho(1);
    await preguntar('gasta');
    complete.mockClear();

    await expect(preguntar('lo que sea')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('la llamada que cruza el umbral se ejecuta ENTERA', async () => {
    // A propósito: cortar una vectorización por la mitad dejaría un documento a medio
    // indexar, y ese estado es peor que unos miles de caracteres de más.
    await ponerTecho(1);

    await expect(preguntar('mucho mas largo que uno')).resolves.toMatchObject({
      content: 'respuesta',
    });
  });

  it('el mensaje explica qué pasa y cuándo se arregla, sin jerga', async () => {
    await ponerTecho(1);
    await preguntar('gasta');

    await expect(preguntar('otra')).rejects.toThrow(/mañana/i);
    await expect(preguntar('otra')).rejects.toThrow(
      /máximo de uso de inteligencia artificial/i,
    );
    await expect(preguntar('otra')).rejects.not.toThrow(/cuota|token|métrica/i);
  });

  it('CRÍTICO: el tope de una empresa no afecta a otra', async () => {
    const otra = await createTestOrg('tope-ia-vecina');
    try {
      await prisma.llmProfile.create({
        data: {
          organizationId: otra.orgId,
          provider: 'OPENAI',
          modelName: 'de-prueba',
          isDefault: true,
        },
      });
      await ponerTecho(1);
      await preguntar('gasta');
      await expect(preguntar('otra')).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      // La vecina sigue funcionando: el contador es por organización.
      const vecina = await registry.resolveForOrganization(otra.orgId);
      await expect(
        vecina.provider.complete(
          { messages: [{ role: 'user', content: 'hola' }] },
          vecina.profile.modelName,
          vecina.apiKey,
        ),
      ).resolves.toMatchObject({ content: 'respuesta' });
    } finally {
      await destroyTestOrg(otra);
    }
  });

  it('CRÍTICO: guardar otro ajuste de la empresa no borra el techo', async () => {
    // `settings` es un cajón compartido y cada pantalla manda solo su parte. Cuando se
    // reemplazaba el objeto entero, guardar la exigencia de fiabilidad dejaba el techo de
    // gasto en el valor por defecto sin que nadie lo hubiera tocado.
    const organizations = new OrganizationsService(db);

    await ponerTecho(10);
    await organizations.update(org.orgId, {
      settings: { knowledgeEngine: { confidence: { minimumFloor: 0.8 } } },
    });

    const despues = await prisma.organization.findUniqueOrThrow({
      where: { id: org.orgId },
    });
    expect(despues.settings).toMatchObject({
      ai: { dailyCharacterLimit: 10 },
      knowledgeEngine: { confidence: { minimumFloor: 0.8 } },
    });

    // Y el techo sigue frenando de verdad, no solo sobreviviendo en la fila.
    await preguntar('aaaaaaaaaaaa');
    await expect(preguntar('otra')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sin techo declarado se usa el de por defecto, que no estorba', async () => {
    // Una empresa recién creada no tiene ajustes: el producto tiene que funcionar igual.
    await preguntar('una pregunta normal');

    await expect(preguntar('y otra')).resolves.toMatchObject({
      content: 'respuesta',
    });
  });
});

import { IngestFromSourceUseCase } from '../../src/knowledge-engine/application/ingest-from-source.use-case';
import { KnowledgeSourcesService } from '../../src/knowledge-engine/application/knowledge-sources.service';
import { RetrieveContextUseCase } from '../../src/knowledge-engine/application/retrieve-context.use-case';
import { CollectionAccessService } from '../../src/knowledge-engine/application/collection-access.service';
import { CanonicalizeUseCase } from '../../src/knowledge-engine/application/canonicalize.use-case';
import { collectionsScope } from '../../src/knowledge-engine/domain/knowledge-scope';
import type { ConnectorRegistry } from '../../src/knowledge-engine/infrastructure/connectors/connector-registry.service';
import type { ClassifyContentUseCase } from '../../src/knowledge-engine/application/classify-content.use-case';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  auditService,
  chunkAndEmbed,
  connectorRegistry,
  createTestOrg,
  destroyTestOrg,
  encryptionService,
  prisma,
  restrictedPerimeter,
  type TestOrg,
  operationalAlerts,
} from './fixtures';

/**
 * Que lo que entra sea PREGUNTABLE — contra Postgres real, con pgvector.
 *
 * ## Por qué esta suite existe
 *
 * `ChunkAndEmbedUseCase` llevaba escrito, registrado como proveedor y probado por su cuenta
 * desde la subfase 2.6, y **no lo invocaba nadie**. Consecuencia: cualquier documento que
 * subiera una persona real quedaba guardado, clasificado, versionado y visible en su lista, y no
 * aparecía nunca al preguntar — porque la recuperación es vectorial y no había un solo fragmento.
 * Las suites del chat no lo detectaban porque sembraban los fragmentos con Prisma.
 *
 * Aquí se comprueba lo contrario: que la tubería de ingesta deja el conocimiento realmente
 * recuperable, y que sigue haciéndolo cuando el documento cambia o cuando se sincroniza dos
 * veces. Es la garantía sin la cual el producto no responde a nada.
 */
describe('El conocimiento ingerido es preguntable (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let ingest: IngestFromSourceUseCase;
  let sources: KnowledgeSourcesService;
  let connectors: ConnectorRegistry;

  const classify = {
    execute: () =>
      Promise.resolve({ businessArea: null, tags: [], certainty: 0 }),
  } as unknown as ClassifyContentUseCase;

  const POLITICA =
    'La política de descuentos comerciales fija un máximo del quince por ciento para el canal ' +
    'mayorista. Cualquier descuento superior exige autorización expresa del responsable de ' +
    'área, registrada por escrito antes de trasladar la oferta al cliente. La dirección revisa ' +
    'los umbrales cada trimestre atendiendo al volumen contratado por cada cliente.';

  beforeEach(async () => {
    org = await createTestOrg('preguntable');
    connectors = connectorRegistry();
    ingest = new IngestFromSourceUseCase(
      db,
      connectors,
      classify,
      encryptionService(),
      auditService(db),
      restrictedPerimeter(db, connectors),
      chunkAndEmbed(db),
      operationalAlerts(db),
    );
    sources = new KnowledgeSourcesService(
      db,
      encryptionService(),
      restrictedPerimeter(db, connectors),
    );
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Fuente de subida manual con su colección, como la crearía una persona. */
  const seedSource = async () => {
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: org.orgId, name: 'Comercial' },
    });
    await new CollectionAccessService(db, auditService(db)).grant({
      organizationId: org.orgId,
      knowledgeCollectionId: collection.id,
      userId: org.userId,
      grantedById: org.userId,
    });
    const source = await sources.create(org.orgId, org.userId, {
      name: 'Mis documentos',
      type: 'FILE_UPLOAD',
      connectorKey: 'file_upload_v1',
      knowledgeCollectionIds: [collection.id],
    });

    return { source, collection };
  };

  const upload = (
    knowledgeSourceId: string,
    text: string,
    name = 'politica.txt',
  ) =>
    ingest.execute({
      organizationId: org.orgId,
      knowledgeSourceId,
      connectorInput: {
        file: {
          originalname: name,
          mimetype: 'text/plain',
          size: Buffer.byteLength(text),
          buffer: Buffer.from(text, 'utf8'),
        },
      },
    });

  it('CRÍTICO: subir un documento lo deja con fragmentos vectorizados', async () => {
    const { source } = await seedSource();

    const result = await upload(source.id, POLITICA);

    expect(result.stats.itemsCreated).toBe(1);
    // Y NO se contó como no recuperable: entró y quedó preguntable.
    expect(result.stats.itemsNotRetrievable).toBe(0);

    const item = await prisma.knowledgeItem.findFirstOrThrow({
      where: { organizationId: org.orgId },
    });
    const chunks = await prisma.knowledgeChunk.findMany({
      where: { knowledgeItemId: item.id },
    });

    expect(chunks.length).toBeGreaterThan(0);
    // Con vector de verdad, no una fila vacía: la columna es de tipo pgvector y sin ella el
    // fragmento no participa en ninguna búsqueda.
    const [{ dimensiones }] = await prisma.$queryRaw<{ dimensiones: number }[]>`
      SELECT vector_dims("embedding") AS dimensiones
      FROM "KnowledgeChunk" WHERE "knowledgeItemId" = ${item.id} LIMIT 1`;
    expect(Number(dimensiones)).toBe(1536);
    // Y con la organización marcada en el propio fragmento: el aislamiento no depende de una
    // unión con el ítem.
    expect(chunks.every((chunk) => chunk.organizationId === org.orgId)).toBe(
      true,
    );
  });

  it('CRÍTICO: la recuperación lo encuentra dentro del alcance', async () => {
    const { source, collection } = await seedSource();
    await upload(source.id, POLITICA);

    const retrieve = new RetrieveContextUseCase(
      db,
      {
        // Mismo contrato que el registro real: resuelve proveedor Y clave ya descifrada.
        resolveEmbeddingsForOrganization: () =>
          Promise.resolve({
            provider: {
              // Se pregunta con el MISMO texto: el vector determinista coincide, así que si la
              // recuperación no lo encuentra es porque no hay nada escrito, no porque no se
              // parezca.
              embed: (texts: string[]) =>
                Promise.resolve(
                  texts.map(() => vectorOf(POLITICA.slice(0, 400))),
                ),
            },
            modelName: 'text-embedding-3-small',
            apiKey: undefined,
          }),
      } as unknown as ConstructorParameters<typeof RetrieveContextUseCase>[1],
      // Canonicalización REAL: solo necesita la base de datos, y doblarla dejaría sin
      // ejercitar la exclusión de ítems no canónicos, que forma parte de la recuperación.
      new CanonicalizeUseCase(db),
    );

    const chunks = await retrieve.execute({
      organizationId: org.orgId,
      query: '¿Cuál es el descuento máximo?',
      scope: collectionsScope([collection.id]),
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map((chunk) => chunk.content).join(' ')).toContain(
      'quince por ciento',
    );
  });

  it('sincronizar dos veces no duplica fragmentos', async () => {
    const { source } = await seedSource();
    await upload(source.id, POLITICA);
    const primeros = await prisma.knowledgeChunk.count({
      where: { organizationId: org.orgId },
    });

    // Mismo contenido: la deduplicación lo reconoce y no hay nada que volver a vectorizar.
    const segunda = await upload(source.id, POLITICA);

    expect(segunda.stats.itemsSkippedDuplicate).toBe(1);
    expect(
      await prisma.knowledgeChunk.count({
        where: { organizationId: org.orgId },
      }),
    ).toBe(primeros);
  });

  it('una versión nueva trae SUS fragmentos, y la anterior conserva los suyos', async () => {
    const { source } = await seedSource();
    await upload(source.id, POLITICA);

    const editada = await upload(
      source.id,
      `${POLITICA} Revisado en agosto de 2026 por la dirección comercial.`,
    );
    expect(editada.stats.itemsUpdated).toBe(1);

    const items = await prisma.knowledgeItem.findMany({
      where: { organizationId: org.orgId },
      orderBy: { createdAt: 'asc' },
    });
    expect(items).toHaveLength(2);

    // Cada versión con sus propios fragmentos: el contenido cambió, así que compartirlos
    // devolvería texto que ya no dice lo que dice el documento vigente.
    for (const item of items) {
      expect(
        await prisma.knowledgeChunk.count({
          where: { knowledgeItemId: item.id },
        }),
      ).toBeGreaterThan(0);
    }
  });

  it('otra organización no alcanza los fragmentos ajenos', async () => {
    const { source } = await seedSource();
    await upload(source.id, POLITICA);
    const vecina = await createTestOrg('preguntable-vecina');

    const retrieve = new RetrieveContextUseCase(
      db,
      {
        getEmbeddingProvider: () => ({
          embed: (texts: string[]) =>
            Promise.resolve(texts.map(() => vectorOf(POLITICA.slice(0, 400)))),
        }),
      } as unknown as ConstructorParameters<typeof RetrieveContextUseCase>[1],
      // Canonicalización REAL: solo necesita la base de datos, y doblarla dejaría sin
      // ejercitar la exclusión de ítems no canónicos, que forma parte de la recuperación.
      new CanonicalizeUseCase(db),
    );

    const chunks = await retrieve.execute({
      organizationId: vecina.orgId,
      query: '¿Cuál es el descuento máximo?',
      scope: collectionsScope([]),
    });

    expect(chunks).toHaveLength(0);

    await destroyTestOrg(vecina);
  });
});

/** El mismo vector determinista que usa el fixture, para poder preguntar por lo escrito. */
function vectorOf(text: string): number[] {
  let seed = 0;
  for (const char of text) seed = (seed * 31 + char.charCodeAt(0)) % 2147483647;

  const values = Array.from({ length: 1536 }, () => {
    seed = (seed * 1103515245 + 12345) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  });
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0)) || 1;

  return values.map((v) => v / norm);
}

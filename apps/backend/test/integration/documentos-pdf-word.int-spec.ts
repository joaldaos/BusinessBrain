import { IngestFromSourceUseCase } from '../../src/knowledge-engine/application/ingest-from-source.use-case';
import { KnowledgeSourcesService } from '../../src/knowledge-engine/application/knowledge-sources.service';
import { KnowledgeItemsService } from '../../src/knowledge-engine/application/knowledge-items.service';
import { RetrieveContextUseCase } from '../../src/knowledge-engine/application/retrieve-context.use-case';
import { CollectionAccessService } from '../../src/knowledge-engine/application/collection-access.service';
import { CanonicalizeUseCase } from '../../src/knowledge-engine/application/canonicalize.use-case';
import { collectionsScope } from '../../src/knowledge-engine/domain/knowledge-scope';
import type { ConnectorRegistry } from '../../src/knowledge-engine/infrastructure/connectors/connector-registry.service';
import type { ClassifyContentUseCase } from '../../src/knowledge-engine/application/classify-content.use-case';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { makeDocx, makePdf, makeScannedPdf } from '../documentos-reales';
import {
  auditService,
  chunkAndEmbed,
  connectorRegistry,
  createMember,
  createTestOrg,
  destroyTestOrg,
  encryptionService,
  prisma,
  restrictedPerimeter,
  type TestOrg,
} from './fixtures';

/**
 * PDF y Word de verdad, por la MISMA tubería que un `.txt`.
 *
 * Los documentos se generan en la prueba —no se siembra un `KnowledgeItem` con texto ya
 * extraído— porque lo que hay que demostrar es justamente el recorrido entero: subir → extraer →
 * normalizar → clasificar → deduplicar → versionar → trocear → vectorizar → poder preguntarlo.
 *
 * Es la garantía que faltaba para que una PYME pueda usar el producto: sus documentos habituales
 * son PDF y Word, y hasta ahora el selector los ofrecía y la normalización los rechazaba.
 */
describe('Documentos PDF y Word (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let ingest: IngestFromSourceUseCase;
  let sources: KnowledgeSourcesService;
  let items: KnowledgeItemsService;
  let access: CollectionAccessService;
  let connectors: ConnectorRegistry;

  const classify = {
    execute: () =>
      Promise.resolve({ businessArea: null, tags: [], certainty: 0 }),
  } as unknown as ClassifyContentUseCase;

  const CLAUSULA =
    'La política de descuentos comerciales fija un máximo del quince por ciento para el canal ' +
    'mayorista. Cualquier descuento superior exige autorización expresa del responsable de área.';
  const ANEXO =
    'El anexo segundo recoge las condiciones de devolución acordadas con cada distribuidor, ' +
    'incluyendo los plazos máximos de aceptación y el procedimiento de reclamación aplicable.';

  beforeEach(async () => {
    org = await createTestOrg('documentos');
    connectors = connectorRegistry();
    access = new CollectionAccessService(db, auditService(db));
    items = new KnowledgeItemsService(db, access);
    ingest = new IngestFromSourceUseCase(
      db,
      connectors,
      classify,
      encryptionService(),
      auditService(db),
      restrictedPerimeter(db, connectors),
      chunkAndEmbed(db),
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

  const seedSource = async () => {
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: org.orgId, name: 'Contratos' },
    });
    await access.grant({
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
    file: { name: string; mimetype: string; buffer: Buffer },
  ) =>
    ingest.execute({
      organizationId: org.orgId,
      knowledgeSourceId,
      connectorInput: {
        file: {
          originalname: file.name,
          mimetype: file.mimetype,
          size: file.buffer.length,
          buffer: file.buffer,
        },
      },
    });

  const uploadPdf = async (
    sourceId: string,
    pages: string[],
    name = 'contrato.pdf',
  ) =>
    upload(sourceId, {
      name,
      mimetype: 'application/pdf',
      buffer: await makePdf(pages),
    });

  const uploadDocx = (
    sourceId: string,
    paragraphs: string[],
    name = 'propuesta.docx',
  ) =>
    upload(sourceId, {
      name,
      mimetype:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: makeDocx(paragraphs),
    });

  describe('un PDF real llega hasta poder preguntarse', () => {
    it('CRÍTICO: se ingesta, se indexa y queda con fragmentos vectorizados', async () => {
      const { source } = await seedSource();

      const result = await uploadPdf(source.id, [CLAUSULA, ANEXO]);

      expect(result.status).toBe('SUCCESS');
      expect(result.stats.itemsCreated).toBe(1);
      expect(result.stats.itemsFailed).toBe(0);
      // Y quedó PREGUNTABLE, que es lo que hace útil todo lo anterior.
      expect(result.stats.itemsNotRetrievable).toBe(0);

      const item = await prisma.knowledgeItem.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });
      expect(item.status).toBe('INDEXED');
      expect(item.title).toBe('contrato.pdf');
      expect(item.contentText).toContain('quince por ciento');
      expect(item.contentText).toContain('anexo segundo');

      expect(
        await prisma.knowledgeChunk.count({
          where: { knowledgeItemId: item.id },
        }),
      ).toBeGreaterThan(0);
    });

    it('conserva la PÁGINA, reutilizando el encabezado que ya entiende el troceado', async () => {
      // Sin arquitectura paralela: el troceado ya guarda `heading` por fragmento y la cita ya
      // lo muestra. Marcar las páginas como encabezados hace que la cita diga de qué página
      // sale la respuesta.
      const { source } = await seedSource();
      await uploadPdf(source.id, [CLAUSULA, ANEXO]);

      const chunks = await prisma.knowledgeChunk.findMany({
        where: { organizationId: org.orgId },
        orderBy: { chunkIndex: 'asc' },
      });

      const headings = chunks.map(
        (chunk) => (chunk.metadata as { heading?: string }).heading,
      );
      expect(headings).toContain('Página 1');
      expect(headings).toContain('Página 2');
    });

    it('un PDF ESCANEADO se señala como no procesable, sin inventar OCR', async () => {
      const { source } = await seedSource();

      const result = await uploadPdf(source.id, []).catch(() => null);
      void result;

      const escaneado = await upload(source.id, {
        name: 'escaneado.pdf',
        mimetype: 'application/pdf',
        buffer: await makeScannedPdf(),
      });

      expect(escaneado.stats.itemsFailed).toBe(1);
      expect(escaneado.stats.itemsCreated).toBe(0);

      // Y queda registrado con el nombre del fichero y un motivo que se entiende.
      const job = await prisma.ingestionJob.findFirstOrThrow({
        where: { organizationId: org.orgId },
        orderBy: { startedAt: 'desc' },
      });
      expect(job.error).toContain('escaneado.pdf');
      expect(job.error).toMatch(/documentos escaneados/i);
      expect(job.error).not.toMatch(/Error:|Exception|undefined|at .*\.ts/);
    });

    it('un PDF corrupto falla SOLO él y no tumba la ingesta', async () => {
      const { source } = await seedSource();

      // Cabecera válida y cuerpo destrozado: pasa el reconocimiento de formato y revienta al
      // interpretarse, que es el caso realista de un fichero truncado al copiarse.
      const corrupto = Buffer.concat([
        Buffer.from('%PDF-1.7\n'),
        Buffer.from('basura que no es un PDF'.repeat(20)),
      ]);

      const result = await upload(source.id, {
        name: 'roto.pdf',
        mimetype: 'application/pdf',
        buffer: corrupto,
      });

      expect(result.stats.itemsFailed).toBe(1);
      const job = await prisma.ingestionJob.findFirstOrThrow({
        where: { organizationId: org.orgId },
        orderBy: { startedAt: 'desc' },
      });
      expect(job.error).toContain('roto.pdf');
      expect(job.error).toMatch(/no hemos podido leer|dañado/i);
    });
  });

  describe('un Word real llega hasta poder preguntarse', () => {
    it('CRÍTICO: se ingesta, se indexa y queda con fragmentos vectorizados', async () => {
      const { source } = await seedSource();

      const result = await uploadDocx(source.id, [CLAUSULA, ANEXO]);

      expect(result.stats.itemsCreated).toBe(1);
      expect(result.stats.itemsNotRetrievable).toBe(0);

      const item = await prisma.knowledgeItem.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });
      expect(item.title).toBe('propuesta.docx');
      expect(item.contentText).toContain('quince por ciento');
      expect(
        await prisma.knowledgeChunk.count({
          where: { knowledgeItemId: item.id },
        }),
      ).toBeGreaterThan(0);
    });

    it('un Word corrupto falla de forma controlada', async () => {
      const { source } = await seedSource();

      const result = await upload(source.id, {
        name: 'roto.docx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // Firma de ZIP correcta, contenido que no es un ZIP.
        buffer: Buffer.concat([
          Buffer.from([0x50, 0x4b, 0x03, 0x04]),
          Buffer.from('esto no es un docx'),
        ]),
      });

      expect(result.stats.itemsFailed).toBe(1);
      expect(result.status).toBe('FAILED');
    });
  });

  describe('lo que NO se acepta', () => {
    it('un tipo incompatible se rechaza con un motivo comprensible', async () => {
      const { source } = await seedSource();

      const result = await upload(source.id, {
        name: 'programa.exe',
        mimetype: 'application/x-msdownload',
        buffer: Buffer.from('MZ\x90\x00'),
      });

      expect(result.stats.itemsFailed).toBe(1);
      const job = await prisma.ingestionJob.findFirstOrThrow({
        where: { organizationId: org.orgId },
        orderBy: { startedAt: 'desc' },
      });
      expect(job.error).toMatch(/no se puede leer todavía/i);
    });

    it('CRÍTICO: un fichero renombrado no llega al intérprete equivocado', async () => {
      const { source } = await seedSource();

      const result = await upload(source.id, {
        name: 'disfrazado.pdf',
        mimetype: 'application/pdf',
        buffer: makeDocx([CLAUSULA]),
      });

      expect(result.stats.itemsFailed).toBe(1);
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(0);
    });
  });

  describe('el resto del motor sigue funcionando igual', () => {
    it('un PDF idéntico subido dos veces NO se duplica', async () => {
      const { source } = await seedSource();
      await uploadPdf(source.id, [CLAUSULA]);

      const segunda = await uploadPdf(source.id, [CLAUSULA]);

      expect(segunda.stats.itemsSkippedDuplicate).toBe(1);
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(1);
    });

    it('un PDF revisado produce una VERSIÓN, no un documento suelto', async () => {
      const { source } = await seedSource();
      await uploadPdf(source.id, [CLAUSULA, ANEXO]);

      await uploadPdf(source.id, [
        CLAUSULA,
        `${ANEXO} Revisado en agosto de 2026 por la dirección comercial.`,
      ]);

      expect(
        await prisma.knowledgeItemLineageEdge.count({
          where: { organizationId: org.orgId, type: 'UPDATES' },
        }),
      ).toBe(1);
    });

    it('un .txt sigue entrando exactamente igual', async () => {
      // La compatibilidad no se da por supuesta: la normalización cambió para todos.
      const { source } = await seedSource();

      const result = await upload(source.id, {
        name: 'notas.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from(CLAUSULA, 'utf8'),
      });

      expect(result.stats.itemsCreated).toBe(1);
      expect(result.stats.itemsNotRetrievable).toBe(0);
    });

    it('un documento ilegible entre dos válidos no impide que entren los otros', async () => {
      const { source } = await seedSource();

      await uploadPdf(source.id, [CLAUSULA], 'bueno-1.pdf');
      await upload(source.id, {
        name: 'roto.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\nbasura'),
      });
      await uploadDocx(source.id, [ANEXO], 'bueno-2.docx');

      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: org.orgId, status: 'INDEXED' },
        }),
      ).toBe(2);
    });
  });

  describe('CRÍTICO: el alcance sigue mandando', () => {
    it('quien no tiene la colección concedida no ve ni recupera el PDF', async () => {
      const { source, collection } = await seedSource();
      await uploadPdf(source.id, [CLAUSULA]);

      const ajeno = await createMember(org, 'MEMBER');

      // Ni en la lista de documentos...
      expect(await items.findAll(org.orgId, ajeno)).toHaveLength(0);

      // ...ni por recuperación, que es la vía que alimenta las respuestas.
      const retrieve = new RetrieveContextUseCase(
        db,
        {
          resolveEmbeddingsForOrganization: () =>
            Promise.resolve({
              provider: {
                embed: (texts: string[]) =>
                  Promise.resolve(
                    texts.map(() => new Array<number>(1536).fill(0.01)),
                  ),
              },
              modelName: 'text-embedding-3-small',
              apiKey: undefined,
            }),
        } as unknown as ConstructorParameters<typeof RetrieveContextUseCase>[1],
        new CanonicalizeUseCase(db),
      );

      const suyos = await access.accessibleCollectionIds({
        organizationId: org.orgId,
        userId: ajeno,
      });
      expect(suyos).not.toContain(collection.id);
      expect(
        await retrieve.execute({
          organizationId: org.orgId,
          query: '¿Cuál es el descuento máximo?',
          scope: collectionsScope(suyos),
        }),
      ).toHaveLength(0);
    });
  });
});

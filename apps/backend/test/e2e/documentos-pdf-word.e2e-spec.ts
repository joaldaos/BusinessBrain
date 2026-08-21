import { MembershipRole } from '@businessbrain/database';
import { makeDocx, makePdf, makeScannedPdf } from '../documentos-reales';
import {
  addMember,
  as,
  createTenant,
  destroyTenant,
  llmScript,
  prisma,
  startTestApp,
  stopTestApp,
  type TestActor,
  type TestTenant,
} from './harness';

/**
 * PDF y Word por HTTP, subidos como los sube el navegador.
 *
 * `multipart/form-data` con un fichero binario real: es la vía por la que entra un documento de
 * verdad, y la única que ejercita el límite de tamaño, la comprobación de tipo de la ruta y el
 * interceptor de subida. Nada se siembra en la base de datos.
 */
describe('Documentos PDF y Word (E2E)', () => {
  let tenant: TestTenant;
  const extraUsers: string[] = [];

  const CLAUSULA =
    'La política de descuentos comerciales fija un máximo del quince por ciento para el canal ' +
    'mayorista. Cualquier descuento superior exige autorización expresa del responsable de área.';

  beforeAll(async () => {
    await startTestApp();
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    llmScript.answers = [];
    tenant = await createTenant('docs');
  });

  afterEach(async () => {
    await destroyTenant(tenant, extraUsers.splice(0));
  });

  /** Colección concedida a quien la crea, y una fuente de subida manual. */
  const seedSource = async () => {
    const collection = await as(tenant.owner, tenant)
      .post('/knowledge-collections')
      .send({ name: 'Contratos' })
      .expect(201);

    const source = await as(tenant.owner, tenant)
      .post('/knowledge-sources')
      .send({
        name: 'Mis documentos',
        type: 'FILE_UPLOAD',
        connectorKey: 'file_upload_v1',
        knowledgeCollectionIds: [collection.body.data.id],
      })
      .expect(201);

    return {
      sourceId: source.body.data.id as string,
      collectionId: collection.body.data.id as string,
    };
  };

  const upload = (
    sourceId: string,
    file: { name: string; mime: string; buffer: Buffer },
    actor: TestActor = tenant.owner,
  ) =>
    as(actor, tenant)
      .post(`/knowledge-sources/${sourceId}/sync`)
      .attach('file', file.buffer, {
        filename: file.name,
        contentType: file.mime,
      });

  const PDF_MIME = 'application/pdf';
  const DOCX_MIME =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  it('la interfaz recibe la lista de formatos DESDE quien valida', async () => {
    // El selector prometía PDF y Word cuando la normalización los rechazaba: eran dos listas
    // distintas. Ahora es una.
    const formats = await as(tenant.owner, tenant)
      .get('/knowledge-sources/supported-formats')
      .expect(200);

    expect(formats.body.data.extensions).toEqual(
      expect.arrayContaining(['.pdf', '.docx', '.txt', '.md', '.html']),
    );
  });

  it('CRITERIO DE CIERRE: un PDF y un Word reales se suben, se indexan y se preguntan', async () => {
    const { sourceId } = await seedSource();

    const pdf = await upload(sourceId, {
      name: 'contrato.pdf',
      mime: PDF_MIME,
      buffer: await makePdf([
        CLAUSULA,
        'Anexo con condiciones de devolución acordadas.',
      ]),
    }).expect(201);
    expect(pdf.body.data.stats.itemsCreated).toBe(1);
    expect(pdf.body.data.stats.itemsFailed).toBe(0);

    const docx = await upload(sourceId, {
      name: 'propuesta.docx',
      mime: DOCX_MIME,
      buffer: makeDocx([
        'La propuesta comercial contempla un plazo de entrega de treinta días naturales ' +
          'desde la firma, con penalización por retraso.',
      ]),
    }).expect(201);
    expect(docx.body.data.stats.itemsCreated).toBe(1);

    // Aparecen en la lista de conocimiento, indexados.
    const items = await as(tenant.owner, tenant)
      .get('/knowledge-items')
      .expect(200);
    const titles = items.body.data.map((item: { title: string }) => item.title);
    expect(titles).toEqual(
      expect.arrayContaining(['contrato.pdf', 'propuesta.docx']),
    );
    expect(
      items.body.data.every(
        (item: { status: string }) => item.status === 'INDEXED',
      ),
    ).toBe(true);

    // Y con fragmentos vectorizados: sin ellos no habría nada que encontrar.
    expect(
      await prisma.knowledgeChunk.count({
        where: { organizationId: tenant.organizationId },
      }),
    ).toBeGreaterThan(0);

    // Preguntar sobre su contenido devuelve una respuesta CON CITA a esos documentos.
    llmScript.answers = ['El máximo es del quince por ciento [1].'];
    const conversation = await as(tenant.owner, tenant)
      .post('/conversations')
      .send({ title: 'Descuentos' })
      .expect(201);
    const answer = await as(tenant.owner, tenant)
      .post(`/conversations/${conversation.body.data.id}/messages`)
      .send({ content: '¿Cuál es nuestro descuento máximo?' })
      .expect(201);

    expect(answer.body.data.citations.length).toBeGreaterThan(0);
    const citedIds = answer.body.data.citations.map(
      (citation: { knowledgeItemId: string }) => citation.knowledgeItemId,
    );
    const ids = items.body.data.map((item: { id: string }) => item.id);
    expect(ids).toEqual(expect.arrayContaining([citedIds[0]]));
  });

  describe('lo que no se puede leer se dice, sin tumbar nada', () => {
    it('un PDF escaneado queda señalado con un motivo comprensible', async () => {
      const { sourceId } = await seedSource();

      const result = await upload(sourceId, {
        name: 'escaneado.pdf',
        mime: PDF_MIME,
        buffer: await makeScannedPdf(),
      }).expect(201);

      expect(result.body.data.stats.itemsFailed).toBe(1);
      expect(result.body.data.stats.itemsCreated).toBe(0);

      // El motivo llega a la fuente, que es lo que enseña la pantalla.
      const source = await as(tenant.owner, tenant)
        .get(`/knowledge-sources/${sourceId}`)
        .expect(200);
      expect(source.body.data.lastError).toMatch(/documentos escaneados/i);
      expect(source.body.data.lastError).not.toMatch(
        /Error:|Exception|at .*\.ts|undefined/,
      );
    });

    it('un documento corrupto no impide que el siguiente entre', async () => {
      const { sourceId } = await seedSource();

      await upload(sourceId, {
        name: 'roto.pdf',
        mime: PDF_MIME,
        buffer: Buffer.from('%PDF-1.7\nesto no es un pdf'),
      }).expect(201);

      const bueno = await upload(sourceId, {
        name: 'bueno.pdf',
        mime: PDF_MIME,
        buffer: await makePdf([CLAUSULA]),
      }).expect(201);

      expect(bueno.body.data.stats.itemsCreated).toBe(1);
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: tenant.organizationId, status: 'INDEXED' },
        }),
      ).toBe(1);
    });

    it('CRÍTICO: un tipo incompatible se rechaza en la puerta', async () => {
      const { sourceId } = await seedSource();

      const respuesta = await upload(sourceId, {
        name: 'programa.exe',
        mime: 'application/x-msdownload',
        buffer: Buffer.from('MZ\x90\x00'),
      }).expect(400);

      expect(JSON.stringify(respuesta.body)).toMatch(
        /no podemos leer este tipo/i,
      );
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: tenant.organizationId },
        }),
      ).toBe(0);
    });

    it('CRÍTICO: un archivo demasiado grande se rechaza', async () => {
      const { sourceId } = await seedSource();

      // Por encima del tope de la ruta. Sin él, una sola subida podría agotar la memoria.
      const enorme = Buffer.concat([
        Buffer.from('%PDF-1.7\n'),
        Buffer.alloc(26 * 1024 * 1024, 0x20),
      ]);

      const respuesta = await upload(sourceId, {
        name: 'enorme.pdf',
        mime: PDF_MIME,
        buffer: enorme,
      });

      expect(respuesta.status).toBeGreaterThanOrEqual(400);
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: tenant.organizationId },
        }),
      ).toBe(0);
    });
  });

  it('CRÍTICO: quien no tiene la colección no ve el PDF ajeno', async () => {
    const { sourceId } = await seedSource();
    await upload(sourceId, {
      name: 'confidencial.pdf',
      mime: PDF_MIME,
      buffer: await makePdf([CLAUSULA]),
    }).expect(201);

    const colega: TestActor = await addMember(
      tenant,
      MembershipRole.MEMBER,
      'colega',
    );
    extraUsers.push(colega.userId);

    const suyos = await as(colega, tenant).get('/knowledge-items').expect(200);
    expect(suyos.body.data).toHaveLength(0);

    // Ni preguntando: sin alcance no hay material y no se inventa una respuesta.
    llmScript.answers = ['Da igual lo que diga el modelo.'];
    const conversation = await as(colega, tenant)
      .post('/conversations')
      .send({ title: 'Curioseando' })
      .expect(201);
    const answer = await as(colega, tenant)
      .post(`/conversations/${conversation.body.data.id}/messages`)
      .send({ content: '¿Cuál es nuestro descuento máximo?' })
      .expect(201);

    expect(answer.body.data.citations).toHaveLength(0);
    expect(answer.body.data.content).not.toContain('quince por ciento');
  });

  it('los formatos de siempre siguen entrando igual', async () => {
    // La normalización cambió para todos: la compatibilidad no se da por supuesta.
    const { sourceId } = await seedSource();

    for (const file of [
      { name: 'notas.txt', mime: 'text/plain', buffer: Buffer.from(CLAUSULA) },
      {
        name: 'guia.md',
        mime: 'text/markdown',
        buffer: Buffer.from(`# Guía\n\n${CLAUSULA}`),
      },
      {
        name: 'pagina.html',
        mime: 'text/html',
        buffer: Buffer.from(
          `<html><body><p>${CLAUSULA} Extra.</p></body></html>`,
        ),
      },
    ]) {
      const result = await upload(sourceId, file).expect(201);
      expect(result.body.data.stats.itemsFailed).toBe(0);
    }

    expect(
      await prisma.knowledgeItem.count({
        where: { organizationId: tenant.organizationId, status: 'INDEXED' },
      }),
    ).toBe(3);
  });
});

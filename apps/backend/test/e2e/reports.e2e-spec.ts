import { MembershipRole } from '@businessbrain/database';
import {
  addMember,
  as,
  createTenant,
  destroyTenant,
  http,
  prisma,
  startTestApp,
  stopTestApp,
  type TestActor,
  type TestTenant,
} from './harness';

/**
 * Informes por HTTP — fase 6.
 *
 * El objetivo de cierre completo: organización → automatización → reloj → análisis →
 * comprensión → informe → `ReportRun` trazable → PDF entregado bajo demanda, respetando el
 * alcance en cada paso.
 */
describe('Informes (E2E)', () => {
  let tenant: TestTenant;
  const extraUsers: string[] = [];

  beforeAll(async () => {
    await startTestApp();
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    tenant = await createTenant('reports');
  });

  afterEach(async () => {
    await destroyTenant(tenant, extraUsers.splice(0));
  });

  const template = {
    sections: [{ type: 'INSIGHTS', title: 'Qué hemos comprendido', limit: 10 }],
  };

  /** Conocimiento bajo el piso de confianza: produce señal determinista. */
  const seedDecayedKnowledge = async (collectionName = 'Ventas') => {
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: tenant.organizationId, name: collectionName },
    });
    const source = await prisma.knowledgeSource.create({
      data: {
        organizationId: tenant.organizationId,
        type: 'FILE_UPLOAD',
        name: 'Fuente E2E',
        connectorKey: 'file_upload_v1',
        createdById: tenant.owner.userId,
        status: 'CONNECTED',
        configEnc: '',
      },
    });
    const item = await prisma.knowledgeItem.create({
      data: {
        organizationId: tenant.organizationId,
        originKnowledgeSourceId: source.id,
        currentKnowledgeSourceId: source.id,
        title: 'Política de descuentos comerciales',
        contentText: 'Los descuentos superan el margen objetivo. '.repeat(5),
        contentHash: `hash-${Math.random()}`,
        status: 'INDEXED',
        indexedAt: new Date(),
        businessArea: 'SALES',
        confidenceScore: 0.05,
        confidenceComputedAt: new Date(),
      },
    });
    await prisma.knowledgeItemCollection.create({
      data: {
        organizationId: tenant.organizationId,
        knowledgeItemId: item.id,
        knowledgeCollectionId: collection.id,
      },
    });
    await as(tenant.owner, tenant)
      .post(`/knowledge-collections/${collection.id}/access`)
      .send({ userId: tenant.owner.userId })
      .expect(201);

    return { collection, item };
  };

  it('OBJETIVO DE CIERRE: automatización → reloj → análisis → informe → PDF', async () => {
    await seedDecayedKnowledge();

    // 1. Se define el informe.
    const report = await as(tenant.owner, tenant)
      .post('/reports')
      .send({ name: 'Resumen semanal', template })
      .expect(201);
    const reportId: string = report.body.data.id;

    // 2. Una automatización encadena análisis e informe, sin nadie delante.
    const automation = await as(tenant.owner, tenant)
      .post('/automations')
      .send({
        name: 'Barrido y resumen',
        triggerType: 'SCHEDULE',
        triggerConfig: { cron: '0 8 * * 1', timezone: 'Europe/Madrid' },
        actions: [
          { type: 'RUN_ANALYSIS' },
          { type: 'GENERATE_REPORT', reportId },
        ],
      })
      .expect(201);
    const automationId: string = automation.body.data.id;

    // 3. Se ejecuta por el mismo camino que recorre el reloj.
    const run = await as(tenant.owner, tenant)
      .post(`/automations/${automationId}/run`)
      .expect(201);
    expect(run.body.data.status).toBe('SUCCESS');

    // 4. El sistema comprendió, y el informe quedó registrado.
    const insights = await as(tenant.owner, tenant)
      .get('/insights')
      .expect(200);
    expect(insights.body.data.length).toBeGreaterThan(0);

    const runs = await as(tenant.owner, tenant)
      .get(`/reports/${reportId}/runs`)
      .expect(200);
    expect(runs.body.data).toHaveLength(1);
    expect(runs.body.data[0].status).toBe('SUCCESS');
    // El fichero no se guarda: la traza dice qué contenía, no dónde está.
    expect(runs.body.data[0].fileUrl).toBeNull();

    // 5. Y el PDF se entrega bajo demanda, con el alcance de quien lo pide.
    const pdf = await as(tenant.owner, tenant)
      .post(`/reports/${reportId}/generate`)
      .expect(201);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.headers['content-disposition']).toMatch(/attachment; filename=/);
    expect(pdf.headers['x-report-run-id']).toBeTruthy();
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');

    /*
     * 6. Y el PDF se entiende sin saber nada de IA.
     *
     * Es lo que se lleva a una reunión y lo que se le reenvía a la gestoría: ahí no puede
     * abrir cada punto con «la confianza cayó a 0.64, por debajo del umbral 0.95». Se lee el
     * documento de verdad, no el buffer: el texto va comprimido y buscar cadenas en los
     * bytes daría un falso verde.
     */
    const { extractText, getDocumentProxy } = await import('unpdf');
    const documento = await getDocumentProxy(
      new Uint8Array(Buffer.from(pdf.body)),
    );
    const { text } = await extractText(documento, { mergePages: false });
    const paginas: string[] = Array.isArray(text) ? text : [String(text)];

    const cuerpo = paginas.slice(0, -1).join(' ');
    const anexo = paginas[paginas.length - 1];

    // El cuerpo habla de negocio.
    expect(cuerpo).not.toMatch(
      /umbral|recuperable|ANOMALY|PATTERN|confianza 0/i,
    );
    expect(cuerpo).toMatch(
      /ya no ofrece la seguridad que pide vuestra empresa/i,
    );
    expect(cuerpo).toMatch(/Qué hacer: /);
    // Ningún carácter que la fuente del PDF no sepa dibujar: `→` salía como `!’`.
    expect(cuerpo).not.toMatch(/!’|Ã|�/);

    // Y el anexo conserva ENTERA la trazabilidad: sin él, simplificar sería perder.
    expect(anexo).toMatch(/detalle técnico/i);
    expect(anexo).toMatch(/umbral/i);
    expect(anexo).toMatch(/confianza \d/i);
  });

  describe('el alcance gobierna el contenido del PDF', () => {
    it('dos personas reciben informes DISTINTOS del mismo informe', async () => {
      await seedDecayedKnowledge();
      await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);

      const report = await as(tenant.owner, tenant)
        .post('/reports')
        .send({ name: 'Resumen', template })
        .expect(201);
      const reportId: string = report.body.data.id;

      const sinAcceso: TestActor = await addMember(
        tenant,
        MembershipRole.MEMBER,
      );
      extraUsers.push(sinAcceso.userId);

      const conAcceso = await as(tenant.owner, tenant)
        .post(`/reports/${reportId}/generate`)
        .expect(201);
      const acotado = await as(sinAcceso, tenant)
        .post(`/reports/${reportId}/generate`)
        .expect(201);

      // Un PDF es la forma más fácil de que una fuga sobreviva a los permisos. Aquí no:
      // exactamente la misma regla que al leer `GET /insights`.
      expect(Buffer.from(conAcceso.body).length).toBeGreaterThan(
        Buffer.from(acotado.body).length,
      );
    });

    it('otra organización no puede generar ni ver el informe', async () => {
      const report = await as(tenant.owner, tenant)
        .post('/reports')
        .send({ name: 'Resumen', template })
        .expect(201);
      const reportId: string = report.body.data.id;

      const rival = await createTenant('reports-rival');
      await as(rival.owner, rival).get(`/reports/${reportId}`).expect(404);
      await as(rival.owner, rival)
        .post(`/reports/${reportId}/generate`)
        .expect(404);
      await destroyTenant(rival);
    });

    it('sin sesión no se llega a ninguna ruta', async () => {
      await http().get('/reports').expect(401);
      await http().post('/reports/cualquiera/generate').expect(401);
    });
  });

  describe('qué puede declarar una plantilla', () => {
    it('RECHAZA una consulta libre', async () => {
      await as(tenant.owner, tenant)
        .post('/reports')
        .send({
          name: 'Puerta trasera',
          template: {
            sections: [
              { type: 'SQL', title: 'x', sql: 'SELECT * FROM "Insight"' },
            ],
          },
        })
        .expect(400);
    });

    it('RECHAZA un informe sin secciones', async () => {
      await as(tenant.owner, tenant)
        .post('/reports')
        .send({ name: 'Vacío', template: { sections: [] } })
        .expect(400);
    });

    it('RECHAZA una sección sin cota', async () => {
      await as(tenant.owner, tenant)
        .post('/reports')
        .send({
          name: 'Sin cota',
          template: {
            sections: [{ type: 'INSIGHTS', title: 'Todo', limit: 5000 }],
          },
        })
        .expect(400);
    });
  });

  describe('quién puede hacer qué', () => {
    it('un MEMBER puede generar y leer, pero NO definir', async () => {
      const member: TestActor = await addMember(tenant, MembershipRole.MEMBER);
      extraUsers.push(member.userId);

      const report = await as(tenant.owner, tenant)
        .post('/reports')
        .send({ name: 'Resumen', template })
        .expect(201);
      const reportId: string = report.body.data.id;

      // Generar solo produce lo que esa persona ya podría leer por su cuenta.
      await as(member, tenant).get('/reports').expect(200);
      await as(member, tenant)
        .post(`/reports/${reportId}/generate`)
        .expect(201);

      // Definir la plantilla decide qué se mira: eso exige ADMIN.
      await as(member, tenant)
        .post('/reports')
        .send({ name: 'Suyo', template })
        .expect(403);
      await as(member, tenant).delete(`/reports/${reportId}`).expect(403);
    });
  });
});

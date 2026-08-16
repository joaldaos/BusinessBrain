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
 * Automatizaciones por HTTP — fase 6.
 *
 * El reloj es la primera capacidad del sistema que actúa sin nadie delante. Esta suite existe
 * para comprobar por HTTP que sigue estando gobernada: quién puede concederla, qué puede
 * declararse, y que lo que se ejecuta desatendido queda registrado y es consultable.
 */
describe('Automatizaciones (E2E)', () => {
  let tenant: TestTenant;
  const extraUsers: string[] = [];

  beforeAll(async () => {
    await startTestApp();
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    tenant = await createTenant('automations');
  });

  afterEach(async () => {
    await destroyTenant(tenant, extraUsers.splice(0));
  });

  const plan = {
    name: 'Barrido semanal de comprensión',
    triggerType: 'SCHEDULE',
    triggerConfig: { cron: '0 8 * * 1', timezone: 'Europe/Madrid' },
    actions: [{ type: 'RUN_ANALYSIS' }],
  };

  /** Conocimiento con la confianza bajo el piso: produce señal determinista. */
  const seedDecayedKnowledge = async () => {
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: tenant.organizationId, name: 'Ventas' },
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

  it('CRITERIO DE CIERRE: se programa, se ejecuta y produce comprensión consultable', async () => {
    await seedDecayedKnowledge();

    // 1. Se concede la ejecución desatendida.
    const created = await as(tenant.owner, tenant)
      .post('/automations')
      .send(plan)
      .expect(201);
    const automationId: string = created.body.data.id;
    expect(created.body.data.status).toBe('ACTIVE');
    // Queda con fecha: el reloj sabrá cuándo reclamarla.
    expect(created.body.data.nextRunAt).toBeTruthy();

    // 2. Se ejecuta por el MISMO camino que recorre el reloj.
    const run = await as(tenant.owner, tenant)
      .post(`/automations/${automationId}/run`)
      .expect(201);
    expect(run.body.data.status).toBe('SUCCESS');

    // 3. Lo que se hizo sin nadie delante es consultable, con su diario.
    const runs = await as(tenant.owner, tenant)
      .get(`/automations/${automationId}/runs`)
      .expect(200);
    expect(runs.body.data).toHaveLength(1);
    expect(runs.body.data[0].status).toBe('SUCCESS');
    expect(JSON.stringify(runs.body.data[0].logs)).toMatch(/AnalysisRun/);

    // 4. Y el sistema comprendió de verdad: hay conclusiones legibles por HTTP.
    const insights = await as(tenant.owner, tenant)
      .get('/insights')
      .expect(200);
    expect(insights.body.data.length).toBeGreaterThan(0);
  });

  describe('quién puede conceder ejecución desatendida', () => {
    it('un MEMBER puede leerlas pero NO crearlas', async () => {
      const member: TestActor = await addMember(tenant, MembershipRole.MEMBER);
      extraUsers.push(member.userId);

      await as(member, tenant).get('/automations').expect(200);
      // Crear una automatización concede que algo se ejecute solo y de forma repetida.
      await as(member, tenant).post('/automations').send(plan).expect(403);
    });

    it('un MEMBER no puede dispararlas ni retirarlas', async () => {
      const member: TestActor = await addMember(tenant, MembershipRole.MEMBER);
      extraUsers.push(member.userId);

      const created = await as(tenant.owner, tenant)
        .post('/automations')
        .send(plan)
        .expect(201);
      const id: string = created.body.data.id;

      await as(member, tenant).post(`/automations/${id}/run`).expect(403);
      await as(member, tenant).delete(`/automations/${id}`).expect(403);
    });

    it('sin sesión no se llega a ninguna ruta', async () => {
      await http().get('/automations').expect(401);
      await http().post('/automations').send(plan).expect(401);
    });

    it('otra organización no ve la automatización ni puede dispararla', async () => {
      const created = await as(tenant.owner, tenant)
        .post('/automations')
        .send(plan)
        .expect(201);
      const id: string = created.body.data.id;

      const rival = await createTenant('automations-rival');
      await as(rival.owner, rival).get(`/automations/${id}`).expect(404);
      await as(rival.owner, rival).post(`/automations/${id}/run`).expect(404);
      await destroyTenant(rival);
    });
  });

  describe('qué puede declararse', () => {
    it('RECHAZA una acción que tocaría el mundo exterior', async () => {
      // El Principio de Evolución Asistida lo garantiza la arquitectura, no la buena fe de
      // quien redacta el JSON.
      await as(tenant.owner, tenant)
        .post('/automations')
        .send({
          ...plan,
          actions: [{ type: 'SEND_EMAIL', to: 'jefe@empresa.com' }],
        })
        .expect(400);
    });

    it('RECHAZA un calendario que no puede ejecutarse', async () => {
      await as(tenant.owner, tenant)
        .post('/automations')
        .send({
          ...plan,
          triggerConfig: { cron: 'todos los lunes', timezone: 'UTC' },
        })
        .expect(400);
    });

    it('RECHAZA un calendario sin zona horaria', async () => {
      await as(tenant.owner, tenant)
        .post('/automations')
        .send({ ...plan, triggerConfig: { cron: '0 8 * * 1' } })
        .expect(400);
    });

    it('RECHAZA una automatización sin acciones', async () => {
      await as(tenant.owner, tenant)
        .post('/automations')
        .send({ ...plan, actions: [] })
        .expect(400);
    });
  });

  it('pausar la retira del reloj sin perder su historial', async () => {
    const created = await as(tenant.owner, tenant)
      .post('/automations')
      .send(plan)
      .expect(201);
    const id: string = created.body.data.id;
    await as(tenant.owner, tenant).post(`/automations/${id}/run`).expect(201);

    const paused = await as(tenant.owner, tenant)
      .patch(`/automations/${id}`)
      .send({ status: 'PAUSED' })
      .expect(200);
    expect(paused.body.data.status).toBe('PAUSED');
    expect(paused.body.data.nextRunAt).toBeNull();

    const runs = await as(tenant.owner, tenant)
      .get(`/automations/${id}/runs`)
      .expect(200);
    expect(runs.body.data).toHaveLength(1);
  });
});

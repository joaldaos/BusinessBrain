import { MembershipRole } from '@businessbrain/database';
import {
  addMember,
  as,
  createTenant,
  destroyTenant,
  http,
  llmScript,
  prisma,
  startTestApp,
  stopTestApp,
  type TestActor,
  type TestTenant,
} from './harness';

/**
 * Fase 6, subfase 6.1 — el Understanding Engine, alcanzable de verdad.
 *
 * La auditoría de cierre de la Fase 5 encontró que el motor de comprensión **no tenía ningún
 * consumidor**: ni controlador ni planificador. Ninguna organización podía declarar un
 * objetivo, lanzar un análisis ni escalar nada, así que `GET /recommendations` devolvía
 * siempre vacío. Cero objetivos y cero recomendaciones creados en toda la vida del proyecto,
 * confirmado contra la base de datos.
 *
 * Esta suite existe para demostrar lo contrario, y por HTTP: el criterio de cierre es la
 * cadena completa, no que las piezas existan.
 */
describe('Understanding Engine (E2E)', () => {
  let tenant: TestTenant;
  let intruder: TestTenant;
  const extraUsers: string[] = [];

  beforeAll(async () => {
    await startTestApp();
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    llmScript.answers = [];
    tenant = await createTenant('understanding');
    intruder = await createTenant('rival');
  });

  afterEach(async () => {
    await destroyTenant(tenant, extraUsers.splice(0));
    await destroyTenant(intruder);
  });

  /**
   * Conocimiento que produce una señal DETERMINISTA.
   *
   * Un `KnowledgeItem` con la confianza por debajo del piso de la organización (0.2) genera
   * una señal `CONFIDENCE_DECAYED`, y de ahí sale un `Insight` sin depender del modelo. Es lo
   * que permite que esta suite pruebe la cadena real en vez de un doble: la comprensión que
   * se cura y se escala más abajo la ha producido el motor de verdad.
   */
  const seedDecayedKnowledge = async (
    target: TestTenant,
    collectionName = 'Ventas',
  ) => {
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: target.organizationId, name: collectionName },
    });
    const source = await prisma.knowledgeSource.create({
      data: {
        organizationId: target.organizationId,
        type: 'FILE_UPLOAD',
        name: 'Fuente E2E',
        connectorKey: 'file_upload_v1',
        createdById: target.owner.userId,
        status: 'CONNECTED',
        configEnc: '',
      },
    });
    const item = await prisma.knowledgeItem.create({
      data: {
        organizationId: target.organizationId,
        originKnowledgeSourceId: source.id,
        currentKnowledgeSourceId: source.id,
        title: 'Política de descuentos comerciales',
        contentText:
          'Los descuentos aplicados superan el margen objetivo. '.repeat(5),
        contentHash: `hash-${Math.random()}`,
        status: 'INDEXED',
        indexedAt: new Date(),
        businessArea: 'SALES',
        // Por debajo del piso (0.2): produce señal.
        confidenceScore: 0.05,
        confidenceComputedAt: new Date(),
      },
    });
    await prisma.knowledgeItemCollection.create({
      data: {
        organizationId: target.organizationId,
        knowledgeItemId: item.id,
        knowledgeCollectionId: collection.id,
      },
    });

    return { collection, item };
  };

  const grant = async (
    target: TestTenant,
    collectionId: string,
    actor: TestActor,
  ) =>
    as(target.owner, target)
      .post(`/knowledge-collections/${collectionId}/access`)
      .send({ userId: actor.userId })
      .expect(201);

  const contract = {
    title: 'Revisar la política de descuentos',
    detected: 'La confianza del documento de descuentos ha caído bajo el piso.',
    justification: 'Una política desactualizada guía decisiones comerciales.',
    estimatedImpact: 'Recuperación de 3 puntos de margen.',
    advantages: 'Margen sostenible y criterio comercial homogéneo.',
    drawbacks: 'Requiere revisión manual del equipo de ventas.',
    affectedAreas: 'Ventas, Finanzas.',
    migrationPlan: 'no aplica (sin impacto estructural)',
  };

  // ── CRITERIO DE CIERRE ───────────────────────────────────────────────────
  describe('cadena completa por HTTP', () => {
    it('conocimiento → objetivo → análisis → Insight → curación → Recommendation → aceptación', async () => {
      const { collection } = await seedDecayedKnowledge(tenant);
      await grant(tenant, collection.id, tenant.owner);

      // 1. La empresa declara qué le importa. Sin esto, el gate de riesgo/oportunidad no
      //    puede anclar ningún juicio de valor (§8).
      const objective = await as(tenant.owner, tenant)
        .post('/business-objectives')
        .send({ statement: 'El margen comercial no debe bajar del 30 %.' })
        .expect(201);
      expect(objective.body.data.status).toBe('CONFIRMED');
      expect(objective.body.data.origin).toBe('MANUAL_DECLARATION');

      // 2. Se lanza el análisis. Aquí es donde el motor razona de verdad.
      const run = await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);
      expect(run.body.data.status).toBe('SUCCESS');
      expect(run.body.data.insightsCreated).toBeGreaterThan(0);

      // 3. La comprensión producida es legible, acotada por las colecciones concedidas.
      const insights = await as(tenant.owner, tenant)
        .get('/insights')
        .expect(200);
      expect(insights.body.data.length).toBeGreaterThan(0);
      const insight = insights.body.data[0];
      expect(insight.summary).toBeTruthy();
      expect(insight.evidence.length).toBeGreaterThan(0);

      // 4. Curación humana: una persona da por buena la conclusión.
      await as(tenant.owner, tenant)
        .post(`/insights/${insight.id}/curate`)
        .send({ type: 'CONFIRMATION', comment: 'Correcto, hay que revisarlo.' })
        .expect(201);

      // 5. Escalado al contrato completo del Principio de Evolución Asistida.
      const escalated = await as(tenant.owner, tenant)
        .post(`/insights/${insight.id}/escalate`)
        .send(contract)
        .expect(201);
      expect(escalated.body.data.status).toBe('NEW');
      expect(escalated.body.data.sourceInsightId).toBe(insight.id);
      expect(escalated.body.data.effectiveCollectionScope).toEqual([
        collection.id,
      ]);

      // 6. Aparece en la superficie de recomendaciones — lo que hasta ahora era imposible.
      const list = await as(tenant.owner, tenant)
        .get('/recommendations')
        .expect(200);
      expect(list.body.data.map((r: { id: string }) => r.id)).toContain(
        escalated.body.data.id,
      );

      // 7. Decisión humana, con traza y sin ejecutar nada externo.
      const accepted = await as(tenant.owner, tenant)
        .post(`/recommendations/${escalated.body.data.id}/accept`)
        .expect(201);
      expect(accepted.body.data.status).toBe('ACCEPTED');
      expect(accepted.body.data.resolvedById).toBe(tenant.owner.userId);

      const log = await prisma.auditLog.findFirst({
        where: {
          targetType: 'Recommendation',
          targetId: escalated.body.data.id,
        },
      });
      expect(log?.metadata).toMatchObject({
        previousStatus: 'NEW',
        newStatus: 'ACCEPTED',
        externalActionExecuted: false,
      });
    });
  });

  // ── Aislamiento entre organizaciones ─────────────────────────────────────
  describe('aislamiento cross-tenant', () => {
    it('los insights de una organización no se ven desde otra', async () => {
      const { collection } = await seedDecayedKnowledge(tenant);
      await grant(tenant, collection.id, tenant.owner);
      await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);

      const mine = await as(tenant.owner, tenant).get('/insights').expect(200);
      expect(mine.body.data.length).toBeGreaterThan(0);

      const theirs = await as(intruder.owner, intruder)
        .get('/insights')
        .expect(200);
      expect(theirs.body.data).toHaveLength(0);

      // Y por id directo: fuera del tenant no debe poder distinguirse que existe.
      await as(intruder.owner, intruder)
        .get(`/insights/${mine.body.data[0].id}`)
        .expect(404);
    });

    it('no se puede curar ni escalar un Insight de otra organización', async () => {
      const { collection } = await seedDecayedKnowledge(tenant);
      await grant(tenant, collection.id, tenant.owner);
      await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);
      const insight = (await as(tenant.owner, tenant).get('/insights')).body
        .data[0];

      await as(intruder.owner, intruder)
        .post(`/insights/${insight.id}/curate`)
        .send({ type: 'CONFIRMATION' })
        .expect(404);
      await as(intruder.owner, intruder)
        .post(`/insights/${insight.id}/escalate`)
        .send(contract)
        .expect(404);
    });

    it('un objetivo de otra organización no es visible ni modificable', async () => {
      const objective = await as(tenant.owner, tenant)
        .post('/business-objectives')
        .send({ statement: 'Objetivo privado de ACME.' })
        .expect(201);

      await as(intruder.owner, intruder)
        .get(`/business-objectives/${objective.body.data.id}`)
        .expect(404);
      await as(intruder.owner, intruder)
        .post(`/business-objectives/${objective.body.data.id}/confirm`)
        .expect(404);
      const list = await as(intruder.owner, intruder)
        .get('/business-objectives')
        .expect(200);
      expect(list.body.data).toHaveLength(0);
    });

    it('el historial de análisis no cruza organizaciones', async () => {
      await seedDecayedKnowledge(tenant);
      await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);

      const theirs = await as(intruder.owner, intruder)
        .get('/analysis-runs')
        .expect(200);
      expect(theirs.body.data).toHaveLength(0);
    });
  });

  // ── Aislamiento por colección ────────────────────────────────────────────
  describe('aislamiento por colección', () => {
    it('sin la colección concedida, el Insight no se lee', async () => {
      const { collection } = await seedDecayedKnowledge(tenant);
      await grant(tenant, collection.id, tenant.owner);
      await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);
      const insight = (await as(tenant.owner, tenant).get('/insights')).body
        .data[0];

      const sinAcceso = await addMember(tenant, MembershipRole.MEMBER, 'sin');
      extraUsers.push(sinAcceso.userId);

      const list = await as(sinAcceso, tenant).get('/insights').expect(200);
      expect(list.body.data).toHaveLength(0);
      // Dentro de la organización sí tiene derecho a saber que existe algo que no puede ver.
      await as(sinAcceso, tenant).get(`/insights/${insight.id}`).expect(403);
    });

    it('IMPOSIBLE curar un Insight fuera del alcance del actor', async () => {
      const { collection } = await seedDecayedKnowledge(tenant);
      await grant(tenant, collection.id, tenant.owner);
      await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);
      const insight = (await as(tenant.owner, tenant).get('/insights')).body
        .data[0];

      const sinAcceso = await addMember(
        tenant,
        MembershipRole.MEMBER,
        'curador',
      );
      extraUsers.push(sinAcceso.userId);

      // La curación tiene PRIORIDAD sobre el recálculo automático: es una escritura
      // duradera sobre comprensión que esta persona no puede leer.
      await as(sinAcceso, tenant)
        .post(`/insights/${insight.id}/curate`)
        .send({ type: 'DISMISSAL' })
        .expect(403);

      expect(
        await prisma.insightFeedback.count({
          where: { insightId: insight.id },
        }),
      ).toBe(0);
    });

    it('IMPOSIBLE escalar un Insight fuera del alcance del actor', async () => {
      const { collection } = await seedDecayedKnowledge(tenant);
      await grant(tenant, collection.id, tenant.owner);
      await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);
      const insight = (await as(tenant.owner, tenant).get('/insights')).body
        .data[0];

      // ADMIN de la organización, pero sin la colección concedida: el rol no sustituye al
      // alcance. Escalar sin cubrirlo crearía una Recommendation sobre evidencia que no
      // puede ver — blanqueo de alcance por el lado de quien dispara.
      const admin = await addMember(tenant, MembershipRole.ADMIN, 'admin-sin');
      extraUsers.push(admin.userId);

      await as(admin, tenant)
        .post(`/insights/${insight.id}/escalate`)
        .send(contract)
        .expect(403);

      expect(
        await prisma.recommendation.count({
          where: { organizationId: tenant.organizationId },
        }),
      ).toBe(0);
    });

    it('conceder la colección habilita exactamente lo que faltaba', async () => {
      const { collection } = await seedDecayedKnowledge(tenant);
      await grant(tenant, collection.id, tenant.owner);
      await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);
      const insight = (await as(tenant.owner, tenant).get('/insights')).body
        .data[0];

      const member = await addMember(
        tenant,
        MembershipRole.MEMBER,
        'promovido',
      );
      extraUsers.push(member.userId);
      await as(member, tenant).get(`/insights/${insight.id}`).expect(403);

      await grant(tenant, collection.id, member);

      await as(member, tenant).get(`/insights/${insight.id}`).expect(200);
      await as(member, tenant)
        .post(`/insights/${insight.id}/curate`)
        .send({ type: 'CONFIRMATION' })
        .expect(201);
    });
  });

  // ── Procedencia del objetivo ─────────────────────────────────────────────
  describe('imposibilidad de falsificar `origin`', () => {
    it('el cliente NO puede fijar `origin` ni `status`', async () => {
      // `forbidNonWhitelisted` rechaza de plano lo que no está en el DTO: la procedencia no
      // tiene ni por dónde entrar.
      await as(tenant.owner, tenant)
        .post('/business-objectives')
        .send({
          statement: 'Objetivo con procedencia falsificada.',
          origin: 'INFERRED_FROM_KNOWLEDGE',
        })
        .expect(400);

      await as(tenant.owner, tenant)
        .post('/business-objectives')
        .send({
          statement: 'Objetivo auto-confirmado.',
          status: 'CONFIRMED',
          confidence: 1,
        })
        .expect(400);
    });

    it('el objetivo declarado por HTTP siempre nace MANUAL_DECLARATION', async () => {
      const created = await as(tenant.owner, tenant)
        .post('/business-objectives')
        .send({ statement: 'Reducir el churn por debajo del 5 %.' })
        .expect(201);

      expect(created.body.data.origin).toBe('MANUAL_DECLARATION');
      expect(created.body.data.confirmedById).toBe(tenant.owner.userId);
    });

    it('versionar no edita en sitio: conserva el historial', async () => {
      const created = await as(tenant.owner, tenant)
        .post('/business-objectives')
        .send({ statement: 'Versión inicial.' })
        .expect(201);

      const next = await as(tenant.owner, tenant)
        .post(`/business-objectives/${created.body.data.id}/versions`)
        .send({ statement: 'Versión revisada.' })
        .expect(201);

      expect(next.body.data.supersedesObjectiveId).toBe(created.body.data.id);
      // Por defecto solo se lista la cabeza de la cadena.
      const list = await as(tenant.owner, tenant)
        .get('/business-objectives')
        .expect(200);
      expect(list.body.data.map((o: { id: string }) => o.id)).toEqual([
        next.body.data.id,
      ]);
    });
  });

  // ── Concurrencia y recuperación de ejecuciones ───────────────────────────
  describe('concurrencia de AnalysisRun', () => {
    it('dos análisis SIMULTÁNEOS: solo uno corre, el otro recibe 409', async () => {
      await seedDecayedKnowledge(tenant);

      const [a, b] = await Promise.all([
        as(tenant.owner, tenant).post('/analysis-runs').send({}),
        as(tenant.owner, tenant).post('/analysis-runs').send({}),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      // Y no quedan ejecuciones duplicadas en el historial.
      const runs = await prisma.analysisRun.findMany({
        where: { organizationId: tenant.organizationId },
      });
      expect(runs).toHaveLength(1);
    });

    it('una ejecución ABANDONADA no bloquea para siempre: se recupera', async () => {
      await seedDecayedKnowledge(tenant);

      // Simula un proceso muerto a mitad: RUNNING y antiguo.
      const abandoned = await prisma.analysisRun.create({
        data: {
          organizationId: tenant.organizationId,
          trigger: 'MANUAL',
          status: 'RUNNING',
          startedAt: new Date(Date.now() - 60 * 60 * 1000),
        },
      });

      await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);

      // La abandonada se cierra como fallida, no se borra: forma parte del historial.
      const closed = await prisma.analysisRun.findUnique({
        where: { id: abandoned.id },
      });
      expect(closed?.status).toBe('FAILED');
      expect(closed?.error).toMatch(/abandonada/i);
    });

    it('una ejecución RECIENTE sí bloquea, con 409 explicado', async () => {
      await seedDecayedKnowledge(tenant);
      const running = await prisma.analysisRun.create({
        data: {
          organizationId: tenant.organizationId,
          trigger: 'MANUAL',
          status: 'RUNNING',
          startedAt: new Date(),
        },
      });

      const response = await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({});

      expect(response.status).toBe(409);
      expect(JSON.stringify(response.body)).toContain(running.id);
    });

    it('la concurrencia se acota por organización, no globalmente', async () => {
      await seedDecayedKnowledge(tenant);
      await seedDecayedKnowledge(intruder);
      await prisma.analysisRun.create({
        data: {
          organizationId: tenant.organizationId,
          trigger: 'MANUAL',
          status: 'RUNNING',
          startedAt: new Date(),
        },
      });

      // La otra organización no queda bloqueada por la ejecución de la primera.
      await as(intruder.owner, intruder)
        .post('/analysis-runs')
        .send({})
        .expect(201);
    });

    it('analizar dos veces no duplica el mismo Insight', async () => {
      await seedDecayedKnowledge(tenant);

      const first = await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);
      const second = await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);

      // El segundo reconoce lo ya conocido en vez de crear un duplicado.
      expect(first.body.data.insightsCreated).toBeGreaterThan(0);
      expect(second.body.data.insightsCreated).toBe(0);
      expect(second.body.data.insightsAlreadyKnown).toBeGreaterThan(0);
    });
  });

  // ── Autorización por rol ─────────────────────────────────────────────────
  describe('autorización por rol', () => {
    it('un MEMBER no declara objetivos ni lanza análisis', async () => {
      const member = await addMember(tenant, MembershipRole.MEMBER, 'miembro');
      extraUsers.push(member.userId);

      await as(member, tenant)
        .post('/business-objectives')
        .send({ statement: 'No permitido.' })
        .expect(403);
      await as(member, tenant).post('/analysis-runs').send({}).expect(403);
      await as(member, tenant).get('/analysis-runs').expect(403);
    });

    it('un MEMBER sí lee objetivos e insights', async () => {
      await as(tenant.owner, tenant)
        .post('/business-objectives')
        .send({ statement: 'Visible para el equipo.' })
        .expect(201);
      const member = await addMember(tenant, MembershipRole.MEMBER, 'lector');
      extraUsers.push(member.userId);

      const list = await as(member, tenant)
        .get('/business-objectives')
        .expect(200);
      expect(list.body.data).toHaveLength(1);
      await as(member, tenant).get('/insights').expect(200);
    });

    it('sin token, ninguna ruta del motor responde', async () => {
      await http().get('/insights').expect(401);
      await http().get('/business-objectives').expect(401);
      await http().post('/analysis-runs').expect(401);
    });
  });

  // ── Superficie: lo que NO se expone ──────────────────────────────────────
  describe('superficie mínima', () => {
    it('`historicalMode` NO existe en la API', async () => {
      const { collection } = await seedDecayedKnowledge(tenant);
      await grant(tenant, collection.id, tenant.owner);
      await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);
      const insight = (await as(tenant.owner, tenant).get('/insights')).body
        .data[0];

      // Se descarta el insight para que solo fuera visible en modo histórico.
      await as(tenant.owner, tenant)
        .post(`/insights/${insight.id}/curate`)
        .send({ type: 'DISMISSAL' })
        .expect(201);

      // El parámetro se rechaza de plano, y el descartado no reaparece por ninguna vía.
      await as(tenant.owner, tenant)
        .get('/insights?historicalMode=true')
        .expect(400);
      const after = await as(tenant.owner, tenant).get('/insights').expect(200);
      expect(after.body.data).toHaveLength(0);
    });

    it('no hay forma de crear un Insight a mano', async () => {
      const response = await as(tenant.owner, tenant)
        .post('/insights')
        .send({ summary: 'Inventado' });

      // La comprensión solo nace de un AnalysisRun.
      expect([403, 404, 405]).toContain(response.status);
    });

    it('el escalado exige el contrato COMPLETO de los seis puntos', async () => {
      const { collection } = await seedDecayedKnowledge(tenant);
      await grant(tenant, collection.id, tenant.owner);
      await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);
      const insight = (await as(tenant.owner, tenant).get('/insights')).body
        .data[0];

      const incompleto = { ...contract, migrationPlan: undefined };
      await as(tenant.owner, tenant)
        .post(`/insights/${insight.id}/escalate`)
        .send(incompleto)
        .expect(400);
    });
  });

  // ── Errores tipados y paginación ─────────────────────────────────────────
  describe('errores tipados y paginación', () => {
    it('confirmar un objetivo descartado es 409, no 500', async () => {
      const objective = await as(tenant.owner, tenant)
        .post('/business-objectives')
        .send({ statement: 'Ya no importa.' })
        .expect(201);
      await as(tenant.owner, tenant)
        .post(`/business-objectives/${objective.body.data.id}/discard`)
        .expect(201);

      await as(tenant.owner, tenant)
        .post(`/business-objectives/${objective.body.data.id}/confirm`)
        .expect(409);
    });

    it('un objetivo inexistente es 404, no 500', async () => {
      await as(tenant.owner, tenant)
        .get('/business-objectives/no-existe')
        .expect(404);
    });

    it('una fecha `since` inválida es 400, no 500', async () => {
      await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({ since: 'ayer por la tarde' })
        .expect(400);
    });

    it('el tope de página es duro: no se puede pedir "todo"', async () => {
      await as(tenant.owner, tenant).get('/insights?limit=5000').expect(400);
      await as(tenant.owner, tenant)
        .get('/business-objectives?limit=5000')
        .expect(400);
    });

    it('la paginación de objetivos desplaza de verdad', async () => {
      for (let i = 0; i < 3; i += 1) {
        await as(tenant.owner, tenant)
          .post('/business-objectives')
          .send({ statement: `Objetivo ${i}` })
          .expect(201);
      }

      const first = await as(tenant.owner, tenant)
        .get('/business-objectives?limit=2')
        .expect(200);
      const second = await as(tenant.owner, tenant)
        .get('/business-objectives?limit=2&offset=2')
        .expect(200);

      expect(first.body.data).toHaveLength(2);
      expect(second.body.data).toHaveLength(1);
      const ids = new Set(
        [...first.body.data, ...second.body.data].map(
          (o: { id: string }) => o.id,
        ),
      );
      expect(ids.size).toBe(3);
    });
  });

  // ── Trazabilidad ─────────────────────────────────────────────────────────
  describe('trazabilidad de las decisiones', () => {
    it('la curación queda registrada con su autor y es revocable sin borrar nada', async () => {
      const { collection } = await seedDecayedKnowledge(tenant);
      await grant(tenant, collection.id, tenant.owner);
      await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);
      const insight = (await as(tenant.owner, tenant).get('/insights')).body
        .data[0];

      await as(tenant.owner, tenant)
        .post(`/insights/${insight.id}/curate`)
        .send({ type: 'CONFIRMATION', comment: 'Lo confirmo.' })
        .expect(201);

      const feedback = await prisma.insightFeedback.findFirst({
        where: { insightId: insight.id },
      });
      expect(feedback?.actorUserId).toBe(tenant.owner.userId);
      expect(feedback?.comment).toBe('Lo confirmo.');

      await as(tenant.owner, tenant)
        .post(`/insight-feedback/${feedback!.id}/revoke`)
        .send({ comment: 'Me retracto.' })
        .expect(201);

      // La revocación es una entrada NUEVA: el historial de decisiones no se reescribe.
      const all = await prisma.insightFeedback.findMany({
        where: { insightId: insight.id },
      });
      expect(all).toHaveLength(2);
      expect(all.some((f) => f.type === 'REVOCATION')).toBe(true);
    });

    it('la Recommendation conserva la trazabilidad hasta el Insight de origen', async () => {
      const { collection } = await seedDecayedKnowledge(tenant);
      await grant(tenant, collection.id, tenant.owner);
      await as(tenant.owner, tenant)
        .post('/analysis-runs')
        .send({})
        .expect(201);
      const insight = (await as(tenant.owner, tenant).get('/insights')).body
        .data[0];

      // 7.1: escalar exige curación PROPIA sobre esta versión.
      await as(tenant.owner, tenant)
        .post(`/insights/${insight.id}/curate`)
        .send({ type: 'CONFIRMATION' })
        .expect(201);

      const escalated = await as(tenant.owner, tenant)
        .post(`/insights/${insight.id}/escalate`)
        .send(contract)
        .expect(201);

      const detail = await as(tenant.owner, tenant)
        .get(`/recommendations/${escalated.body.data.id}`)
        .expect(200);
      expect(detail.body.data.sourceInsight.id).toBe(insight.id);
      expect(detail.body.data.migrationPlan).toBe(contract.migrationPlan);
    });
  });
});

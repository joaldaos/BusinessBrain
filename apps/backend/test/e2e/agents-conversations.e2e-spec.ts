import { MembershipRole } from '@businessbrain/database';
import {
  addMember,
  as,
  createTenant,
  destroyTenant,
  http,
  llmScript,
  prisma,
  seedUnderstanding,
  startTestApp,
  stopTestApp,
  type TestActor,
  type TestTenant,
} from './harness';

/**
 * Fase 5, subfase 5.9 — extremo a extremo REAL: HTTP → guards → controllers → application →
 * infrastructure → Postgres.
 *
 * Es la suite que faltaba. Todo lo demás llama a los servicios directamente, y con eso
 * `JwtAuthGuard`, `OrgRoleGuard` y `@OrgRoles` nunca llegaban a ejecutarse: un servicio puede
 * estar impecablemente aislado y quedar expuesto igualmente si la ruta que lo publica no
 * lleva el guard que le toca. Aquí se comprueba la aplicación tal como se despliega.
 */
describe('Agentes y conversaciones (E2E)', () => {
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
    tenant = await createTenant('acme');
    intruder = await createTenant('rival');
  });

  afterEach(async () => {
    await destroyTenant(tenant, extraUsers.splice(0));
    await destroyTenant(intruder);
  });

  /** Colección + agente creados por HTTP, con alcance real. */
  const createAgentViaHttp = async (
    target: TestTenant,
    overrides: Record<string, unknown> = {},
  ) => {
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: target.organizationId, name: 'Ventas' },
    });

    const response = await as(target.owner, target)
      .post('/agents')
      .send({
        name: 'Agente comercial',
        systemPrompt: 'Ayudas al equipo de ventas.',
        knowledgeCollectionIds: [collection.id],
        ...overrides,
      })
      .expect(201);

    // Comprension REAL dentro del alcance del agente: sin material no hay llamada al
    // modelo y el turno terminaria antes del bucle.
    await seedUnderstanding(target, collection.id);

    return { agent: response.body.data, collectionId: collection.id };
  };

  // ── Autenticación ────────────────────────────────────────────────────────
  describe('autenticación', () => {
    it('sin token, toda ruta protegida responde 401', async () => {
      await http().get('/agents').expect(401);
      await http().get('/conversations').expect(401);
      await http().get('/recommendations').expect(401);
      await http().get('/agent-templates').expect(401);
    });

    it('con un token inventado responde 401', async () => {
      await http()
        .get('/agents')
        .set('Authorization', 'Bearer no-es-un-token')
        .expect(401);
    });

    it('con token válido pero sin organización activa no se accede', async () => {
      // Sin `x-org-id` el guard no puede resolver la organización.
      await as(tenant.owner).get('/agents').expect(404);
    });
  });

  // ── Aislamiento entre organizaciones ─────────────────────────────────────
  describe('aislamiento entre organizaciones', () => {
    it('un usuario no puede activar la organización de otro', async () => {
      const response = await as(intruder.owner, tenant).get('/agents');

      expect(response.status).toBe(403);
    });

    it('un agente de otra organización no es visible ni utilizable', async () => {
      const { agent } = await createAgentViaHttp(tenant);

      // El intruso apunta a SU organización pero pide el agente ajeno por id.
      await as(intruder.owner, intruder).get(`/agents/${agent.id}`).expect(404);
      const list = await as(intruder.owner, intruder)
        .get('/agents')
        .expect(200);
      expect(list.body.data).toHaveLength(0);
    });

    it('no se puede crear una conversación con un agente de otra organización', async () => {
      const { agent } = await createAgentViaHttp(tenant);

      const response = await as(intruder.owner, intruder)
        .post('/conversations')
        .send({ agentId: agent.id });

      expect(response.status).toBe(400);
      expect(
        await prisma.conversation.count({
          where: { agentId: agent.id, organizationId: intruder.organizationId },
        }),
      ).toBe(0);
    });

    it('no se puede vincular una colección de otra organización a un agente propio', async () => {
      const theirs = await prisma.knowledgeCollection.create({
        data: { organizationId: tenant.organizationId, name: 'RR. HH.' },
      });

      await as(intruder.owner, intruder)
        .post('/agents')
        .send({
          name: 'Fuga',
          systemPrompt: 'x',
          knowledgeCollectionIds: [theirs.id],
        })
        .expect(400);
    });

    it('una plantilla de otra organización responde 403', async () => {
      const template = await as(tenant.owner, tenant)
        .post('/agent-templates')
        .send({
          name: 'Plantilla propia',
          description: 'Solo de ACME.',
          defaultSystemPrompt: 'x',
        })
        .expect(201);

      await as(intruder.owner, intruder)
        .get(`/agent-templates/${template.body.data.id}`)
        .expect(403);
      await as(intruder.owner, intruder)
        .post(`/agent-templates/${template.body.data.id}/install`)
        .send({})
        .expect(403);
    });

    it('el catálogo de plantillas nunca muestra las de otra organización', async () => {
      await as(tenant.owner, tenant)
        .post('/agent-templates')
        .send({
          name: 'Solo ACME',
          description: 'x',
          defaultSystemPrompt: 'x',
        })
        .expect(201);

      const catalog = await as(intruder.owner, intruder)
        .get('/agent-templates')
        .expect(200);
      expect(catalog.body.data).toHaveLength(0);
    });
  });

  // ── Aislamiento entre usuarios ───────────────────────────────────────────
  describe('aislamiento entre usuarios del mismo tenant', () => {
    it('una conversación es privada de su autor', async () => {
      const other = await addMember(tenant, MembershipRole.ADMIN, 'compa');
      extraUsers.push(other.userId);

      const mine = await as(tenant.owner, tenant)
        .post('/conversations')
        .send({ title: 'Privada' })
        .expect(201);

      // Mismo tenant, incluso rol ADMIN: la conversación de otra persona no se lee.
      await as(other, tenant)
        .get(`/conversations/${mine.body.data.id}`)
        .expect(404);
      const theirList = await as(other, tenant)
        .get('/conversations')
        .expect(200);
      expect(theirList.body.data).toHaveLength(0);
    });

    it('la memoria del agente no cruza entre usuarios', async () => {
      const { agent } = await createAgentViaHttp(tenant, {
        memoryConfig: { strategy: 'long_term', windowSize: 10 },
      });
      const other = await addMember(tenant, MembershipRole.MEMBER, 'vecino');
      extraUsers.push(other.userId);

      // El dueño conversa y el agente anota algo suyo.
      llmScript.answers = [
        'Anotado.\n[[BB_MEMORY]]{"key":"salario","value":"confidencial"}',
      ];
      const mine = await as(tenant.owner, tenant)
        .post('/conversations')
        .send({ agentId: agent.id })
        .expect(201);
      await as(tenant.owner, tenant)
        .post(`/conversations/${mine.body.data.id}/messages`)
        .send({ content: 'mi salario es X' })
        .expect(201);

      const stored = await prisma.agentMemory.findMany({
        where: { agentId: agent.id },
      });
      expect(stored).toHaveLength(1);
      expect(stored[0].userId).toBe(tenant.owner.userId);

      // La otra persona, con el MISMO agente, no ve nada de eso.
      const theirs = await as(other, tenant)
        .post('/conversations')
        .send({ agentId: agent.id })
        .expect(201);
      llmScript.answers = ['Hola.'];
      const answer = await as(other, tenant)
        .post(`/conversations/${theirs.body.data.id}/messages`)
        .send({ content: 'hola' })
        .expect(201);

      expect(JSON.stringify(answer.body)).not.toContain('confidencial');
      expect(
        await prisma.agentMemory.count({
          where: { agentId: agent.id, userId: other.userId },
        }),
      ).toBe(0);
    });
  });

  // ── Autorización por rol ─────────────────────────────────────────────────
  describe('autorización por rol', () => {
    it('un MEMBER no puede crear agentes; un ADMIN sí', async () => {
      const member = await addMember(tenant, MembershipRole.MEMBER, 'miembro');
      const admin = await addMember(tenant, MembershipRole.ADMIN, 'jefa');
      extraUsers.push(member.userId, admin.userId);

      await as(member, tenant)
        .post('/agents')
        .send({ name: 'No permitido', systemPrompt: 'x' })
        .expect(403);
      await as(admin, tenant)
        .post('/agents')
        .send({ name: 'Permitido', systemPrompt: 'x' })
        .expect(201);
    });

    it('un MEMBER puede LEER agentes: el rol acota la escritura, no la lectura', async () => {
      const member = await addMember(tenant, MembershipRole.MEMBER, 'lector');
      extraUsers.push(member.userId);
      await createAgentViaHttp(tenant);

      const list = await as(member, tenant).get('/agents').expect(200);
      expect(list.body.data).toHaveLength(1);
    });

    it('un MEMBER no puede crear ni instalar plantillas', async () => {
      const member = await addMember(tenant, MembershipRole.MEMBER, 'miembro2');
      extraUsers.push(member.userId);
      const template = await as(tenant.owner, tenant)
        .post('/agent-templates')
        .send({ name: 'T', description: 'd', defaultSystemPrompt: 'p' })
        .expect(201);

      await as(member, tenant)
        .post('/agent-templates')
        .send({ name: 'X', description: 'd', defaultSystemPrompt: 'p' })
        .expect(403);
      await as(member, tenant)
        .post(`/agent-templates/${template.body.data.id}/install`)
        .send({})
        .expect(403);
    });

    it('un VIEWER no puede resolver recomendaciones', async () => {
      const viewer = await addMember(tenant, MembershipRole.VIEWER, 'viewer');
      extraUsers.push(viewer.userId);

      // Basta con que el guard corte antes de llegar al servicio.
      const response = await as(viewer, tenant).post(
        '/recommendations/cualquiera/accept',
      );
      expect(response.status).toBe(403);
    });

    it('conceder acceso a colecciones exige ADMIN', async () => {
      const member = await addMember(tenant, MembershipRole.MEMBER, 'miembro3');
      extraUsers.push(member.userId);
      const collection = await prisma.knowledgeCollection.create({
        data: { organizationId: tenant.organizationId, name: 'Ventas' },
      });

      await as(member, tenant)
        .post(`/knowledge-collections/${collection.id}/access`)
        .send({ userId: member.userId })
        .expect(403);
      await as(tenant.owner, tenant)
        .post(`/knowledge-collections/${collection.id}/access`)
        .send({ userId: member.userId })
        .expect(201);
    });
  });

  // ── El turno completo del agente, por HTTP ───────────────────────────────
  describe('turno completo del agente', () => {
    it('CRITERIO DE CIERRE: agente → conversación → memoria → gate → tool → respuesta', async () => {
      const { agent, collectionId } = await createAgentViaHttp(tenant, {
        tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
        memoryConfig: { strategy: 'long_term', windowSize: 10 },
      });

      const conversation = await as(tenant.owner, tenant)
        .post('/conversations')
        .send({ agentId: agent.id })
        .expect(201);

      // 1.ª vuelta: el agente pide una tool READ_ONLY y anota algo.
      // 2.ª vuelta: responde con el resultado.
      llmScript.answers = [
        'Déjame consultarlo.\n' +
          '[[BB_TOOL]]{"tool":"knowledge_search","input":"descuentos"}\n' +
          '[[BB_MEMORY]]{"key":"tema","value":"le interesan los descuentos"}',
        'Según lo consultado, los descuentos están dentro de objetivo.',
      ];

      const response = await as(tenant.owner, tenant)
        .post(`/conversations/${conversation.body.data.id}/messages`)
        .send({ content: '¿cómo van los descuentos?' })
        .expect(201);

      // La herramienta se ejecutó atravesando el gate.
      expect(response.body.data.toolInvocations).toEqual([
        { tool: 'knowledge_search', executed: true },
      ]);
      // La memoria quedó escrita con el alcance del turno autenticado.
      const memories = await prisma.agentMemory.findMany({
        where: { agentId: agent.id, userId: tenant.owner.userId },
      });
      expect(memories).toHaveLength(1);
      expect(memories[0].organizationId).toBe(tenant.organizationId);
      // La persona ve la respuesta final, nunca el protocolo interno.
      expect(response.body.data.content).toContain('dentro de objetivo');
      expect(JSON.stringify(response.body)).not.toContain('BB_TOOL');
      // Y todo quedó trazado en el historial.
      const persisted = await prisma.message.findMany({
        where: { conversationId: conversation.body.data.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(persisted).toHaveLength(2);
      expect(collectionId).toBeDefined();
    });

    it('una tool NO declarada se deniega y queda en auditoría', async () => {
      const { agent } = await createAgentViaHttp(tenant, {
        tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
      });
      const conversation = await as(tenant.owner, tenant)
        .post('/conversations')
        .send({ agentId: agent.id })
        .expect(201);

      llmScript.answers = [
        '[[BB_TOOL]]{"tool":"insight_lookup","input":"x"}',
        'No he podido consultarlo.',
      ];

      const response = await as(tenant.owner, tenant)
        .post(`/conversations/${conversation.body.data.id}/messages`)
        .send({ content: 'dame conclusiones' })
        .expect(201);

      expect(response.body.data.toolInvocations[0].executed).toBe(false);
      const logs = await prisma.auditLog.findMany({
        where: {
          organizationId: tenant.organizationId,
          action: 'agent.tool.denied',
        },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].metadata).toMatchObject({ reason: 'TOOL_NOT_GRANTED' });
    });

    it('una tool con efectos NO se ejecuta aunque el agente la declare AUTONOMOUS', async () => {
      const { agent } = await createAgentViaHttp(tenant, {
        tools: [{ tool: 'send_email', permission: 'AUTONOMOUS' }],
      });
      const conversation = await as(tenant.owner, tenant)
        .post('/conversations')
        .send({ agentId: agent.id })
        .expect(201);

      llmScript.answers = [
        '[[BB_TOOL]]{"tool":"send_email","input":"avisa al cliente"}',
        'No puedo enviar correos.',
      ];

      const response = await as(tenant.owner, tenant)
        .post(`/conversations/${conversation.body.data.id}/messages`)
        .send({ content: 'manda un correo' })
        .expect(201);

      // El techo de la Fase 5 sigue siendo READ_ONLY, de extremo a extremo.
      expect(response.body.data.toolInvocations[0].executed).toBe(false);
    });

    it('el cliente NO puede manipular el contador de tools ni el alcance', async () => {
      const { agent } = await createAgentViaHttp(tenant, {
        tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
        guardrails: { maxToolCallsPerRun: 1 },
      });
      const conversation = await as(tenant.owner, tenant)
        .post('/conversations')
        .send({ agentId: agent.id })
        .expect(201);

      llmScript.answers = [
        '[[BB_TOOL]]{"tool":"knowledge_search","input":"a"}',
        '[[BB_TOOL]]{"tool":"knowledge_search","input":"b"}',
        'Ya está.',
      ];

      // El cliente intenta colar contador y alcance en el cuerpo de la petición.
      const response = await as(tenant.owner, tenant)
        .post(`/conversations/${conversation.body.data.id}/messages`)
        .send({
          content: 'insiste',
          toolCallsSoFar: 0,
          allowedCollectionIds: ['cualquier-coleccion'],
          maxToolCallsPerRun: 99,
        });

      // `forbidNonWhitelisted` rechaza de plano lo que no está en el DTO: el alcance y el
      // contador no tienen ni por dónde entrar.
      expect(response.status).toBe(400);
    });

    it('el tope de tools se agota aunque el modelo insista', async () => {
      const { agent } = await createAgentViaHttp(tenant, {
        tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
        guardrails: { maxToolCallsPerRun: 1 },
      });
      const conversation = await as(tenant.owner, tenant)
        .post('/conversations')
        .send({ agentId: agent.id })
        .expect(201);

      llmScript.answers = [
        '[[BB_TOOL]]{"tool":"knowledge_search","input":"a"}',
        '[[BB_TOOL]]{"tool":"knowledge_search","input":"b"}',
        'Ya está.',
      ];

      const response = await as(tenant.owner, tenant)
        .post(`/conversations/${conversation.body.data.id}/messages`)
        .send({ content: 'insiste' })
        .expect(201);

      const invocations = response.body.data.toolInvocations as {
        executed: boolean;
      }[];
      expect(invocations.filter((i) => i.executed)).toHaveLength(1);
      expect(invocations.filter((i) => !i.executed).length).toBeGreaterThan(0);
    });

    it('sin agentId el comportamiento sigue siendo el de la Fase 4', async () => {
      const conversation = await as(tenant.owner, tenant)
        .post('/conversations')
        .send({})
        .expect(201);

      llmScript.answers = ['Respuesta sin agente.'];
      const response = await as(tenant.owner, tenant)
        .post(`/conversations/${conversation.body.data.id}/messages`)
        .send({ content: 'hola' })
        .expect(201);

      expect(response.body.data.toolInvocations).toEqual([]);
      expect(response.body.data.memoriesRecorded).toBe(0);
    });
  });

  // ── Instalación de plantillas ────────────────────────────────────────────
  describe('instalación de plantillas', () => {
    it('instala una plantilla propia y conserva templateId', async () => {
      const template = await as(tenant.owner, tenant)
        .post('/agent-templates')
        .send({
          name: 'Analista',
          description: 'Analiza ventas.',
          defaultSystemPrompt: 'Analizas ventas.',
          defaultTools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
        })
        .expect(201);

      const installed = await as(tenant.owner, tenant)
        .post(`/agent-templates/${template.body.data.id}/install`)
        .send({})
        .expect(201);

      expect(installed.body.data.templateId).toBe(template.body.data.id);
      expect(installed.body.data.tools).toEqual([
        { tool: 'knowledge_search', permission: 'READ_ONLY' },
      ]);
    });

    it('una plantilla con configuración inválida se rechaza al crearla', async () => {
      await as(tenant.owner, tenant)
        .post('/agent-templates')
        .send({
          name: 'Peligrosa',
          description: 'd',
          defaultSystemPrompt: 'p',
          defaultTools: [{ tool: 'send_email', permission: 'READ_ONLY' }],
        })
        .expect(400);
    });
  });

  // ── Recomendaciones y effectiveCollectionScope ───────────────────────────
  describe('recomendaciones', () => {
    /** Crea una Recommendation con el alcance indicado, como haría el escalado del UE. */
    const seedRecommendation = async (
      target: TestTenant,
      scope: string[],
    ): Promise<string> => {
      const created = await prisma.recommendation.create({
        data: {
          organizationId: target.organizationId,
          title: 'Revisar descuentos',
          description: 'Los descuentos superan el margen.',
          effectiveCollectionScope: scope,
        },
      });
      return created.id;
    };

    const grantAccess = async (
      target: TestTenant,
      collectionId: string,
      actor: TestActor,
    ) => {
      await as(target.owner, target)
        .post(`/knowledge-collections/${collectionId}/access`)
        .send({ userId: actor.userId })
        .expect(201);
    };

    const collection = (target: TestTenant, name: string) =>
      prisma.knowledgeCollection.create({
        data: { organizationId: target.organizationId, name },
      });

    it('acceso COMPLETO al alcance: puede leer', async () => {
      const ventas = await collection(tenant, 'Ventas');
      const finanzas = await collection(tenant, 'Finanzas');
      const id = await seedRecommendation(tenant, [ventas.id, finanzas.id]);
      const reader = await addMember(tenant, MembershipRole.MEMBER, 'lectora');
      extraUsers.push(reader.userId);
      await grantAccess(tenant, ventas.id, reader);
      await grantAccess(tenant, finanzas.id, reader);

      const response = await as(reader, tenant)
        .get(`/recommendations/${id}`)
        .expect(200);
      expect(response.body.data.id).toBe(id);

      const list = await as(reader, tenant).get('/recommendations').expect(200);
      expect(list.body.data).toHaveLength(1);
    });

    it('acceso PARCIAL: denegado y ausente del listado (regla ALL)', async () => {
      const ventas = await collection(tenant, 'Ventas');
      const rrhh = await collection(tenant, 'RR. HH.');
      const id = await seedRecommendation(tenant, [ventas.id, rrhh.id]);
      const reader = await addMember(tenant, MembershipRole.MEMBER, 'parcial');
      extraUsers.push(reader.userId);
      await grantAccess(tenant, ventas.id, reader);

      await as(reader, tenant).get(`/recommendations/${id}`).expect(403);
      const list = await as(reader, tenant).get('/recommendations').expect(200);
      expect(list.body.data).toHaveLength(0);
    });

    it('SIN acceso: denegado incluso al OWNER', async () => {
      const ventas = await collection(tenant, 'Ventas');
      const id = await seedRecommendation(tenant, [ventas.id]);

      // El rol no sustituye al alcance.
      await as(tenant.owner, tenant).get(`/recommendations/${id}`).expect(403);
    });

    it('una recomendación de otra organización nunca es visible', async () => {
      const theirCollection = await collection(intruder, 'Ventas ajenas');
      const id = await seedRecommendation(intruder, [theirCollection.id]);

      await as(tenant.owner, tenant).get(`/recommendations/${id}`).expect(404);
    });

    it('aceptar registra quién y cuándo, y NO ejecuta ninguna acción externa', async () => {
      const ventas = await collection(tenant, 'Ventas');
      const id = await seedRecommendation(tenant, [ventas.id]);
      const decider = await addMember(tenant, MembershipRole.MEMBER, 'decide');
      extraUsers.push(decider.userId);
      await grantAccess(tenant, ventas.id, decider);

      const response = await as(decider, tenant)
        .post(`/recommendations/${id}/accept`)
        .expect(201);

      expect(response.body.data.status).toBe('ACCEPTED');
      expect(response.body.data.resolvedById).toBe(decider.userId);
      expect(response.body.data.resolvedAt).toBeTruthy();

      // Ninguna acción externa: ni agentes, ni conversaciones, ni automatizaciones.
      expect(
        await prisma.automation.count({
          where: { organizationId: tenant.organizationId },
        }),
      ).toBe(0);
      const log = await prisma.auditLog.findFirst({
        where: { targetType: 'Recommendation', targetId: id },
      });
      expect(log?.metadata).toMatchObject({
        previousStatus: 'NEW',
        newStatus: 'ACCEPTED',
        externalActionExecuted: false,
      });
    });

    it('no se puede aceptar una recomendación fuera del propio alcance', async () => {
      const ventas = await collection(tenant, 'Ventas');
      const rrhh = await collection(tenant, 'RR. HH.');
      const id = await seedRecommendation(tenant, [ventas.id, rrhh.id]);
      const partial = await addMember(tenant, MembershipRole.MEMBER, 'medias');
      extraUsers.push(partial.userId);
      await grantAccess(tenant, ventas.id, partial);

      await as(partial, tenant)
        .post(`/recommendations/${id}/accept`)
        .expect(403);

      const untouched = await prisma.recommendation.findUnique({
        where: { id },
      });
      expect(untouched?.status).toBe('NEW');
      expect(untouched?.resolvedById).toBeNull();
    });

    it('no se puede conceder acceso a una colección de otra organización', async () => {
      const theirCollection = await collection(intruder, 'Ajena');

      const response = await as(tenant.owner, tenant)
        .post(`/knowledge-collections/${theirCollection.id}/access`)
        .send({ userId: tenant.owner.userId });

      expect(response.status).toBe(400);
    });
  });

  // ── Higiene de la superficie ─────────────────────────────────────────────
  describe('higiene de la superficie HTTP', () => {
    it('no existe ninguna vía HTTP para crear una Recommendation', async () => {
      const response = await as(tenant.owner, tenant)
        .post('/recommendations')
        .send({ title: 'Inventada', description: 'x' });

      // Generarlas es competencia exclusiva del Understanding Engine.
      expect([403, 404, 405]).toContain(response.status);
    });

    it('un cuerpo con campos no declarados se rechaza', async () => {
      await as(tenant.owner, tenant)
        .post('/agents')
        .send({ name: 'X', systemPrompt: 'y', organizationId: 'otra-org' })
        .expect(400);
    });

    it('ninguna respuesta expone apiKeyEnc', async () => {
      await createAgentViaHttp(tenant);
      const agents = await as(tenant.owner, tenant).get('/agents').expect(200);
      const me = await as(tenant.owner, tenant).get('/auth/me').expect(200);

      expect(JSON.stringify(agents.body)).not.toContain('apiKeyEnc');
      expect(JSON.stringify(me.body)).not.toContain('passwordHash');
    });
  });
});

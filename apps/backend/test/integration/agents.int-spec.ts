import { AgentArea } from '@businessbrain/database';
import { AgentsService } from '../../src/agents/application/agents.service';
import { EnforceAgentPolicyUseCase } from '../../src/agents/application/enforce-agent-policy.use-case';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  createTestOrg,
  destroyTestOrg,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * Fase 5, subfase 5.1 — definición y ciclo de vida de agentes.
 *
 * Lo que un doble no puede demostrar: que el alcance de conocimiento y el perfil de LLM se
 * validan contra la organización REAL, y que un agente de otra organización es invisible.
 * Definir un agente es conceder capacidades; si esa concesión se puede desbordar hacia otro
 * tenant, todo lo que venga después (ejecución, tools, memoria) hereda el fallo.
 */
describe('Agents (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let agents: AgentsService;
  let policy: EnforceAgentPolicyUseCase;

  beforeEach(async () => {
    org = await createTestOrg('agents-int');
    agents = new AgentsService(db);
    policy = new EnforceAgentPolicyUseCase(db);
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const createCollection = (target: TestOrg, name: string) =>
    prisma.knowledgeCollection.create({
      data: { organizationId: target.orgId, name },
    });

  const baseAgent = {
    name: 'Agente de Ventas',
    systemPrompt: 'Ayudas al equipo comercial.',
  };

  const create = (overrides: Record<string, unknown> = {}) =>
    agents.create({
      organizationId: org.orgId,
      createdById: org.userId,
      ...baseAgent,
      ...overrides,
    });

  describe('ciclo de vida', () => {
    it('crea un agente con su configuración normalizada', async () => {
      const agent = await create({
        area: AgentArea.SALES,
        capabilities: ['answer_questions', 'summarize'],
        tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
        memoryConfig: { strategy: 'short_term', windowSize: 5 },
        guardrails: { forbiddenTopics: ['nóminas'], maxToolCallsPerRun: 3 },
      });

      expect(agent.area).toBe(AgentArea.SALES);
      expect(agent.tools).toEqual([
        { tool: 'knowledge_search', permission: 'READ_ONLY' },
      ]);
      expect(agent.memoryConfig).toEqual({
        strategy: 'short_term',
        windowSize: 5,
      });
    });

    it('un agente sin configuración nace sin herramientas y sin memoria', async () => {
      const agent = await create();

      // Las capacidades se conceden, no se presuponen.
      expect(agent.tools).toEqual([]);
      expect(agent.memoryConfig).toEqual({ strategy: 'none', windowSize: 10 });
    });

    it('actualiza y desactiva sin borrar: la trazabilidad se conserva', async () => {
      const agent = await create();

      await agents.update({
        organizationId: org.orgId,
        agentId: agent.id,
        name: 'Renombrado',
      });
      const deactivated = await agents.deactivate({
        organizationId: org.orgId,
        agentId: agent.id,
      });

      expect(deactivated.isActive).toBe(false);
      expect(deactivated.name).toBe('Renombrado');
      // Sigue existiendo: un borrado real se llevaría por delante sus conversaciones.
      expect(
        await prisma.agent.findUnique({ where: { id: agent.id } }),
      ).not.toBeNull();
    });

    it('listar excluye los desactivados salvo que se pidan', async () => {
      const agent = await create();
      await agents.deactivate({ organizationId: org.orgId, agentId: agent.id });

      expect(await agents.list({ organizationId: org.orgId })).toHaveLength(0);
      expect(
        await agents.list({ organizationId: org.orgId, includeInactive: true }),
      ).toHaveLength(1);
    });
  });

  describe('aislamiento entre organizaciones', () => {
    it('una organización no lee agentes de otra', async () => {
      const other = await createTestOrg('agents-int-b');
      const theirs = await agents.create({
        organizationId: other.orgId,
        createdById: other.userId,
        ...baseAgent,
      });

      await expect(
        agents.findOne({ organizationId: org.orgId, agentId: theirs.id }),
      ).rejects.toThrow();
      expect(await agents.list({ organizationId: org.orgId })).toHaveLength(0);

      await destroyTestOrg(other);
    });

    it('una organización no modifica ni desactiva agentes de otra', async () => {
      const other = await createTestOrg('agents-int-c');
      const theirs = await agents.create({
        organizationId: other.orgId,
        createdById: other.userId,
        ...baseAgent,
      });

      await expect(
        agents.update({
          organizationId: org.orgId,
          agentId: theirs.id,
          name: 'secuestrado',
        }),
      ).rejects.toThrow();
      await expect(
        agents.deactivate({ organizationId: org.orgId, agentId: theirs.id }),
      ).rejects.toThrow();

      await destroyTestOrg(other);
    });
  });

  describe('alcance de conocimiento', () => {
    it('vincula colecciones de la propia organización', async () => {
      const collection = await createCollection(org, 'Ventas');

      const agent = await create({ knowledgeCollectionIds: [collection.id] });

      expect(agent.knowledgeCollections).toEqual([
        { id: collection.id, name: 'Ventas' },
      ]);
    });

    it('RECHAZA vincular una colección de otra organización', async () => {
      const other = await createTestOrg('agents-int-d');
      const theirs = await createCollection(other, 'RR. HH. ajeno');

      // Sería una vía de fuga entre tenants: el agente recuperaría conocimiento ajeno con
      // total normalidad, porque el alcance habría quedado legitimado en su configuración.
      await expect(
        create({ knowledgeCollectionIds: [theirs.id] }),
      ).rejects.toThrow(/otra organización/i);

      await destroyTestOrg(other);
    });

    it('RECHAZA una colección inexistente', async () => {
      await expect(
        create({ knowledgeCollectionIds: ['no-existe'] }),
      ).rejects.toThrow(/inexistentes|otra organización/i);
    });

    it('actualizar el alcance lo REEMPLAZA, no lo acumula', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const soporte = await createCollection(org, 'Soporte');
      const agent = await create({ knowledgeCollectionIds: [ventas.id] });

      const updated = await agents.update({
        organizationId: org.orgId,
        agentId: agent.id,
        knowledgeCollectionIds: [soporte.id],
      });

      expect(updated.knowledgeCollections).toEqual([
        { id: soporte.id, name: 'Soporte' },
      ]);
    });

    it('no se puede colar una colección ajena por una actualización', async () => {
      const other = await createTestOrg('agents-int-e');
      const theirs = await createCollection(other, 'Ajena');
      const agent = await create();

      await expect(
        agents.update({
          organizationId: org.orgId,
          agentId: agent.id,
          knowledgeCollectionIds: [theirs.id],
        }),
      ).rejects.toThrow(/otra organización/i);

      await destroyTestOrg(other);
    });
  });

  describe('perfil de LLM', () => {
    it('acepta un perfil de plataforma (sin organización)', async () => {
      const platform = await prisma.llmProfile.create({
        data: { provider: 'OPENAI', modelName: 'gpt-4.1' },
      });

      const agent = await create({ llmProfileId: platform.id });
      expect(agent.llmProfileId).toBe(platform.id);

      await prisma.llmProfile.delete({ where: { id: platform.id } });
    });

    it('RECHAZA el perfil de otra organización: gastaría o expondría su clave BYO', async () => {
      const other = await createTestOrg('agents-int-f');
      const theirs = await prisma.llmProfile.create({
        data: {
          organizationId: other.orgId,
          provider: 'OPENAI',
          modelName: 'gpt-4.1',
          apiKeyEnc: 'clave-cifrada-ajena',
        },
      });

      await expect(create({ llmProfileId: theirs.id })).rejects.toThrow(
        /otra organización/i,
      );

      await destroyTestOrg(other);
    });
  });

  describe('validación de configuración', () => {
    it('RECHAZA una herramienta desconocida antes de persistir nada', async () => {
      await expect(
        create({ tools: [{ tool: 'borrar_todo', permission: 'AUTONOMOUS' }] }),
      ).rejects.toThrow(/borrar_todo/);

      expect(await agents.list({ organizationId: org.orgId })).toHaveLength(0);
    });

    it('RECHAZA declarar READ_ONLY una herramienta con efectos', async () => {
      await expect(
        create({ tools: [{ tool: 'send_email', permission: 'READ_ONLY' }] }),
      ).rejects.toThrow(/send_email/);
    });

    it('revalida la configuración ENTERA en una actualización parcial', async () => {
      const agent = await create({
        tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
      });

      await expect(
        agents.update({
          organizationId: org.orgId,
          agentId: agent.id,
          memoryConfig: { strategy: 'telepatia' },
        }),
      ).rejects.toThrow(/telepatia/);

      // El estado previo sobrevive intacto al intento fallido.
      const unchanged = await agents.findOne({
        organizationId: org.orgId,
        agentId: agent.id,
      });
      expect(unchanged.memoryConfig).toEqual({
        strategy: 'none',
        windowSize: 10,
      });
    });
  });

  describe('gate de políticas (5.2)', () => {
    const enforce = (agentId: string, tool: string, toolCallsSoFar = 0) =>
      policy.execute({
        organizationId: org.orgId,
        agentId,
        tool,
        toolCallsSoFar,
      });

    it('permite una herramienta READ_ONLY concedida', async () => {
      const agent = await create({
        tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
      });

      expect(await enforce(agent.id, 'knowledge_search')).toEqual({
        allowed: true,
        tool: 'knowledge_search',
        permission: 'READ_ONLY',
      });
    });

    it('DENIEGA una herramienta no concedida y deja rastro en auditoría', async () => {
      const agent = await create({
        tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
      });

      const decision = await enforce(agent.id, 'sql_query');
      expect(decision.allowed).toBe(false);

      // Un patrón de intentos denegados es la señal observable de que algo intenta usar el
      // agente para lo que no debe. Sin rastro, el intento es invisible.
      const logs = await prisma.auditLog.findMany({
        where: { organizationId: org.orgId, action: 'agent.tool.denied' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].targetId).toBe(agent.id);
      expect(logs[0].metadata).toMatchObject({
        tool: 'sql_query',
        reason: 'TOOL_NOT_GRANTED',
      });
    });

    it('DENIEGA una herramienta con efectos aunque esté declarada AUTONOMOUS', async () => {
      const agent = await create({
        tools: [{ tool: 'send_email', permission: 'AUTONOMOUS' }],
      });

      const decision = await enforce(agent.id, 'send_email');

      // La configuración concede como mucho; nunca amplía lo que la plataforma ejecuta.
      expect(decision.allowed).toBe(false);
      expect(decision.allowed === false && decision.reason).toBe(
        'PERMISSION_NOT_EXECUTABLE',
      );
    });

    it('DENIEGA a un agente desactivado', async () => {
      const agent = await create({
        tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
      });
      await agents.deactivate({ organizationId: org.orgId, agentId: agent.id });

      const decision = await enforce(agent.id, 'knowledge_search');
      expect(decision.allowed === false && decision.reason).toBe(
        'AGENT_INACTIVE',
      );
    });

    it('DENIEGA usar el agente de otra organización sin revelar que existe', async () => {
      const other = await createTestOrg('agents-int-g');
      const theirs = await agents.create({
        organizationId: other.orgId,
        createdById: other.userId,
        ...baseAgent,
        tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
      });

      const decision = await enforce(theirs.id, 'knowledge_search');
      expect(decision.allowed).toBe(false);
      expect(decision.allowed === false && decision.explanation).not.toContain(
        'desactivado',
      );

      await destroyTestOrg(other);
    });

    it('DENIEGA al agotar el presupuesto de llamadas del turno', async () => {
      const agent = await create({
        tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
        guardrails: { maxToolCallsPerRun: 2 },
      });

      expect((await enforce(agent.id, 'knowledge_search', 1)).allowed).toBe(
        true,
      );
      const exhausted = await enforce(agent.id, 'knowledge_search', 2);
      expect(exhausted.allowed === false && exhausted.reason).toBe(
        'TOOL_CALL_BUDGET_EXHAUSTED',
      );
    });
  });
});

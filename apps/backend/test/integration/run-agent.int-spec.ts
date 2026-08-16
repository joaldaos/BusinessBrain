import { AgentsService } from '../../src/agents/application/agents.service';
import { RunAgentUseCase } from '../../src/agents/application/run-agent.use-case';
import { PrismaMemoryStoreAdapter } from '../../src/agents/infrastructure/prisma-memory-store.adapter';
import { RetrieveInsightsUseCase } from '../../src/understanding-engine/application/retrieve-insights.use-case';
import type { RetrieveContextUseCase } from '../../src/knowledge-engine/application/retrieve-context.use-case';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  auditService,
  createInsight,
  createKnowledgeItem,
  createTestOrg,
  destroyTestOrg,
  prisma,
  type TestOrg,
  insightScope,
} from './fixtures';

/**
 * Fase 5, subfase 5.3 — preparación del turno de ejecución de un agente.
 *
 * Lo que se verifica contra Postgres real es el **alcance**: que un agente acotado a unas
 * colecciones no reciba comprensión sostenida por evidencia de otras. `RetrieveInsights` se
 * usa DE VERDAD (no doblado) porque la regla de cobertura completa del `EffectiveCollectionScope`
 * es precisamente lo que está en juego; el Retriever sí se dobla, porque su acotación tiene
 * su propia suite y aquí solo importa que reciba el alcance correcto.
 */
describe('RunAgent (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let agents: AgentsService;
  let runAgent: RunAgentUseCase;
  let retrieveContextSpy: jest.Mock;
  let memoryStore: PrismaMemoryStoreAdapter;

  beforeEach(async () => {
    org = await createTestOrg('run-agent-int');
    agents = new AgentsService(db, auditService(db));
    retrieveContextSpy = jest.fn().mockResolvedValue([]);

    memoryStore = new PrismaMemoryStoreAdapter(db);
    runAgent = new RunAgentUseCase(
      agents,
      { execute: retrieveContextSpy } as unknown as RetrieveContextUseCase,
      new RetrieveInsightsUseCase(db, insightScope(db)),
      memoryStore,
      // Registro vacio: estas suites no ejercitan la ejecucion de herramientas.
      [],
    );
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const collection = (name: string) =>
    prisma.knowledgeCollection.create({
      data: { organizationId: org.orgId, name },
    });

  /** Un ítem de conocimiento que pertenece a una colección concreta. */
  const itemInCollection = async (collectionId: string) => {
    const item = await createKnowledgeItem(org);
    await prisma.knowledgeItemCollection.create({
      data: {
        knowledgeItemId: item.id,
        knowledgeCollectionId: collectionId,
        organizationId: org.orgId,
      },
    });
    return item;
  };

  const createAgent = (overrides: Record<string, unknown> = {}) =>
    agents.create({
      organizationId: org.orgId,
      createdById: org.userId,
      name: 'Agente de prueba',
      systemPrompt: 'Eres el agente comercial.',
      ...overrides,
    });

  describe('el alcance no es opcional', () => {
    it('un agente SIN colecciones declaradas no ejecuta', async () => {
      const agent = await createAgent();

      // Tratar "sin alcance" como "toda la organización" convertiría el descuido de
      // configuración más fácil de cometer en acceso total, indistinguible de lo correcto.
      await expect(
        runAgent.execute({
          organizationId: org.orgId,
          agentId: agent.id,
          userId: org.userId,
          query: 'cualquier cosa',
        }),
      ).rejects.toThrow(/alcance de conocimiento/i);
    });

    it('un agente desactivado no ejecuta', async () => {
      const ventas = await collection('Ventas');
      const agent = await createAgent({ knowledgeCollectionIds: [ventas.id] });
      await agents.deactivate({
        organizationId: org.orgId,
        agentId: agent.id,
        actorUserId: org.userId,
      });

      await expect(
        runAgent.execute({
          organizationId: org.orgId,
          agentId: agent.id,
          userId: org.userId,
          query: 'hola',
        }),
      ).rejects.toThrow(/desactivado/i);
    });

    it('propaga el alcance del agente al Retriever, nunca vacío', async () => {
      const ventas = await collection('Ventas');
      const agent = await createAgent({ knowledgeCollectionIds: [ventas.id] });

      await runAgent.execute({
        organizationId: org.orgId,
        agentId: agent.id,
        userId: org.userId,
        query: 'presupuesto',
      });

      expect(retrieveContextSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: org.orgId,
          scope: { mode: 'COLLECTIONS', collectionIds: [ventas.id] },
        }),
      );
    });
  });

  describe('aislamiento de la comprensión por colección', () => {
    it('NO entrega un Insight sostenido por evidencia de otra colección', async () => {
      const ventas = await collection('Ventas');
      const rrhh = await collection('RR. HH.');
      const itemRrhh = await itemInCollection(rrhh.id);
      await createInsight(org, {
        subjectIdentity: 'rotacion-de-personal',
        evidenceItemIds: [itemRrhh.id],
      });

      const agent = await createAgent({ knowledgeCollectionIds: [ventas.id] });
      const result = await runAgent.execute({
        organizationId: org.orgId,
        agentId: agent.id,
        userId: org.userId,
        query: '¿qué pasa en la empresa?',
      });

      // Un agente de Ventas no puede enterarse de una conclusión de RR. HH.
      expect(result.insightsUsed).toEqual([]);
    });

    it('SÍ entrega un Insight sostenido por evidencia de su propia colección', async () => {
      const ventas = await collection('Ventas');
      const itemVentas = await itemInCollection(ventas.id);
      await createInsight(org, {
        subjectIdentity: 'caida-de-conversion',
        evidenceItemIds: [itemVentas.id],
      });

      const agent = await createAgent({ knowledgeCollectionIds: [ventas.id] });
      const result = await runAgent.execute({
        organizationId: org.orgId,
        agentId: agent.id,
        userId: org.userId,
        query: '¿qué pasa en ventas?',
      });

      expect(result.insightsUsed).toHaveLength(1);
      expect(result.insightsUsed[0].summary).toContain('caida-de-conversion');
    });

    it('exige cobertura COMPLETA: evidencia mixta no basta con acceso parcial', async () => {
      const ventas = await collection('Ventas');
      const rrhh = await collection('RR. HH.');
      const itemVentas = await itemInCollection(ventas.id);
      const itemRrhh = await itemInCollection(rrhh.id);
      await createInsight(org, {
        subjectIdentity: 'asunto-mixto',
        evidenceItemIds: [itemVentas.id, itemRrhh.id],
      });

      const agent = await createAgent({ knowledgeCollectionIds: [ventas.id] });
      const result = await runAgent.execute({
        organizationId: org.orgId,
        agentId: agent.id,
        userId: org.userId,
        query: 'dame contexto',
      });

      // Acceso a una parte de la evidencia no da derecho a la conclusión entera.
      expect(result.insightsUsed).toEqual([]);
    });

    it('con acceso a TODAS las colecciones de la evidencia, sí lo entrega', async () => {
      const ventas = await collection('Ventas');
      const rrhh = await collection('RR. HH.');
      const itemVentas = await itemInCollection(ventas.id);
      const itemRrhh = await itemInCollection(rrhh.id);
      await createInsight(org, {
        subjectIdentity: 'asunto-mixto',
        evidenceItemIds: [itemVentas.id, itemRrhh.id],
      });

      const agent = await createAgent({
        knowledgeCollectionIds: [ventas.id, rrhh.id],
      });
      const result = await runAgent.execute({
        organizationId: org.orgId,
        agentId: agent.id,
        userId: org.userId,
        query: 'dame contexto',
      });

      expect(result.insightsUsed).toHaveLength(1);
    });
  });

  describe('composición del turno', () => {
    it('el system prompt del agente va primero y los límites de la plataforma encima', async () => {
      const ventas = await collection('Ventas');
      const agent = await createAgent({
        knowledgeCollectionIds: [ventas.id],
        guardrails: { forbiddenTopics: ['nóminas'] },
      });

      const result = await runAgent.execute({
        organizationId: org.orgId,
        agentId: agent.id,
        userId: org.userId,
        query: 'hola',
      });

      // Lo que el operador configuró no puede reescribir los límites de la plataforma.
      expect(result.systemPrompt.indexOf('Eres el agente comercial.')).toBe(0);
      expect(result.systemPrompt).toContain('nóminas');
    });

    it('ofrece solo las herramientas que el gate permitiría', async () => {
      const ventas = await collection('Ventas');
      const agent = await createAgent({
        knowledgeCollectionIds: [ventas.id],
        tools: [
          { tool: 'knowledge_search', permission: 'READ_ONLY' },
          { tool: 'send_email', permission: 'AUTONOMOUS' },
        ],
      });

      const result = await runAgent.execute({
        organizationId: org.orgId,
        agentId: agent.id,
        userId: org.userId,
        query: 'hola',
      });

      expect(result.availableTools).toEqual(['knowledge_search']);
    });

    it('declara que no hay material cuando no hay ni comprensión ni conocimiento', async () => {
      const ventas = await collection('Ventas');
      const agent = await createAgent({ knowledgeCollectionIds: [ventas.id] });

      const result = await runAgent.execute({
        organizationId: org.orgId,
        agentId: agent.id,
        userId: org.userId,
        query: 'algo no indexado',
      });

      expect(result.hasMaterial).toBe(false);
    });

    it('no ejecuta agentes de otra organización', async () => {
      const other = await createTestOrg('run-agent-int-b');
      const theirs = await agents.create({
        organizationId: other.orgId,
        createdById: other.userId,
        name: 'Ajeno',
        systemPrompt: 'x',
      });

      await expect(
        runAgent.execute({
          organizationId: org.orgId,
          agentId: theirs.id,
          userId: org.userId,
          query: 'hola',
        }),
      ).rejects.toThrow();

      await destroyTestOrg(other);
    });
  });
});

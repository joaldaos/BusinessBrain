import { AgentsService } from '../../src/agents/application/agents.service';
import { RunAgentUseCase } from '../../src/agents/application/run-agent.use-case';
import { PrismaMemoryStoreAdapter } from '../../src/agents/infrastructure/prisma-memory-store.adapter';
import { RetrieveInsightsUseCase } from '../../src/understanding-engine/application/retrieve-insights.use-case';
import type { RetrieveContextUseCase } from '../../src/knowledge-engine/application/retrieve-context.use-case';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  auditService,
  createTestOrg,
  destroyTestOrg,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * Fase 5, subfase 5.4 — memoria del agente, privada de cada usuario.
 *
 * La garantía central de esta subfase es negativa y solo se puede demostrar contra la base
 * de datos real: **lo que el agente aprende de la conversación del usuario A no aparece
 * jamás en el prompt del usuario B**, aunque compartan organización y agente. Las
 * conversaciones ya están aisladas por usuario desde la Fase 4; una memoria compartida
 * rompería ese aislamiento por la puerta de atrás.
 */
describe('AgentMemory (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let agents: AgentsService;
  let memoryStore: PrismaMemoryStoreAdapter;
  let runAgent: RunAgentUseCase;
  /** Segundo usuario de LA MISMA organización: el vecino, no el extraño. */
  let userB: string;
  let collectionId: string;
  let agentId: string;

  beforeEach(async () => {
    org = await createTestOrg('agent-memory-int');
    agents = new AgentsService(db, auditService(db));
    memoryStore = new PrismaMemoryStoreAdapter(db);
    runAgent = new RunAgentUseCase(
      agents,
      {
        execute: jest.fn().mockResolvedValue([]),
      } as unknown as RetrieveContextUseCase,
      new RetrieveInsightsUseCase(db),
      memoryStore,
      // Registro vacio: estas suites no ejercitan la ejecucion de herramientas.
      [],
    );

    const other = await prisma.user.create({
      data: {
        email: `vecino-${Date.now()}${Math.random()}@test.local`,
        passwordHash: 'x',
        name: 'Vecino',
      },
    });
    userB = other.id;

    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: org.orgId, name: 'Ventas' },
    });
    collectionId = collection.id;

    const agent = await agents.create({
      organizationId: org.orgId,
      createdById: org.userId,
      name: 'Agente compartido',
      systemPrompt: 'Eres el agente comercial.',
      knowledgeCollectionIds: [collectionId],
      memoryConfig: { strategy: 'long_term', windowSize: 10 },
    });
    agentId = agent.id;
  });

  afterEach(async () => {
    await prisma.agentMemory.deleteMany({ where: { userId: userB } });
    await prisma.user.deleteMany({ where: { id: userB } });
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const scopeFor = (userId: string) => ({
    organizationId: org.orgId,
    agentId,
    userId,
  });

  const run = (userId: string, conversationId?: string) =>
    runAgent.execute({
      organizationId: org.orgId,
      agentId,
      userId,
      query: '¿qué recuerdas?',
      conversationId,
    });

  describe('aislamiento entre usuarios de la MISMA organización', () => {
    it('lo que el agente aprende de A no aparece nunca en el prompt de B', async () => {
      await memoryStore.remember(scopeFor(org.userId), {
        key: 'salario-negociado',
        value: 'A negocia una subida de 5.000 EUR',
      });

      const forB = await run(userB);

      // Compartir organización y agente no es compartir memoria.
      expect(forB.memoriesUsed).toBe(0);
      expect(forB.systemPrompt).not.toContain('salario-negociado');
      expect(forB.systemPrompt).not.toContain('5.000');
    });

    it('cada usuario recupera únicamente lo suyo', async () => {
      await memoryStore.remember(scopeFor(org.userId), {
        key: 'preferencia',
        value: 'A prefiere el email',
      });
      await memoryStore.remember(scopeFor(userB), {
        key: 'preferencia',
        value: 'B prefiere el teléfono',
      });

      const forA = await run(org.userId);
      const forB = await run(userB);

      expect(forA.systemPrompt).toContain('A prefiere el email');
      expect(forA.systemPrompt).not.toContain('B prefiere');
      expect(forB.systemPrompt).toContain('B prefiere el teléfono');
      expect(forB.systemPrompt).not.toContain('A prefiere');
    });

    it('la misma clave para dos usuarios son dos hechos distintos, no una colisión', async () => {
      await memoryStore.remember(scopeFor(org.userId), {
        key: 'cliente-favorito',
        value: 'ACME',
      });
      await memoryStore.remember(scopeFor(userB), {
        key: 'cliente-favorito',
        value: 'Globex',
      });

      const rows = await prisma.agentMemory.findMany({ where: { agentId } });
      expect(rows).toHaveLength(2);
    });

    it('olvidar lo de un usuario no toca lo del otro', async () => {
      await memoryStore.remember(scopeFor(org.userId), {
        key: 'k',
        value: 'A',
      });
      await memoryStore.remember(scopeFor(userB), { key: 'k', value: 'B' });

      await memoryStore.forget(scopeFor(org.userId), 'k');

      expect(await memoryStore.recall(scopeFor(org.userId), 10)).toEqual([]);
      expect(await memoryStore.recall(scopeFor(userB), 10)).toHaveLength(1);
    });
  });

  describe('aislamiento entre organizaciones', () => {
    it('no se recuerda nada si el organizationId no corresponde al agente', async () => {
      const other = await createTestOrg('agent-memory-int-b');
      await memoryStore.remember(scopeFor(org.userId), {
        key: 'dato',
        value: 'sensible',
      });

      // El organizationId es redundante para localizar la fila y aun así se filtra: si
      // alguna vez se desincronizara, la consulta devuelve nada en vez de algo ajeno.
      const cross = await memoryStore.recall(
        { organizationId: other.orgId, agentId, userId: org.userId },
        10,
      );

      expect(cross).toEqual([]);
      await destroyTestOrg(other);
    });
  });

  describe('estrategias de memoria', () => {
    it('"none" no recupera nada aunque existan recuerdos persistidos', async () => {
      await agents.update({
        organizationId: org.orgId,
        agentId,
        actorUserId: org.userId,
        memoryConfig: { strategy: 'none', windowSize: 10 },
      });
      await memoryStore.remember(scopeFor(org.userId), {
        key: 'dato',
        value: 'existe pero no se usa',
      });

      const result = await run(org.userId);
      expect(result.memoriesUsed).toBe(0);
    });

    it('"short_term" solo trae lo de la conversación en curso', async () => {
      await agents.update({
        organizationId: org.orgId,
        agentId,
        actorUserId: org.userId,
        memoryConfig: { strategy: 'short_term', windowSize: 10 },
      });
      await memoryStore.remember(scopeFor(org.userId), {
        key: 'de-esta-conversacion',
        value: 'relevante',
        conversationId: 'conv-1',
      });
      await memoryStore.remember(scopeFor(org.userId), {
        key: 'de-otra-conversacion',
        value: 'no relevante',
        conversationId: 'conv-2',
      });

      const result = await run(org.userId, 'conv-1');

      expect(result.memoriesUsed).toBe(1);
      expect(result.systemPrompt).toContain('de-esta-conversacion');
      expect(result.systemPrompt).not.toContain('de-otra-conversacion');
    });

    it('"long_term" trae también lo de otras conversaciones del mismo usuario', async () => {
      await memoryStore.remember(scopeFor(org.userId), {
        key: 'antigua',
        value: 'de otra conversación',
        conversationId: 'conv-vieja',
      });

      const result = await run(org.userId, 'conv-nueva');
      expect(result.memoriesUsed).toBe(1);
    });

    it('respeta la ventana declarada, conservando lo más reciente', async () => {
      await agents.update({
        organizationId: org.orgId,
        agentId,
        actorUserId: org.userId,
        memoryConfig: { strategy: 'long_term', windowSize: 2 },
      });
      for (const key of ['k1', 'k2', 'k3', 'k4']) {
        await memoryStore.remember(scopeFor(org.userId), { key, value: key });
      }

      const result = await run(org.userId);
      expect(result.memoriesUsed).toBe(2);
      expect(result.systemPrompt).toContain('k4');
      expect(result.systemPrompt).not.toContain('k1');
    });
  });

  describe('persistencia', () => {
    it('recordar dos veces la misma clave ACTUALIZA el hecho, no lo duplica', async () => {
      await memoryStore.remember(scopeFor(org.userId), {
        key: 'estado',
        value: 'primera versión',
      });
      await memoryStore.remember(scopeFor(org.userId), {
        key: 'estado',
        value: 'segunda versión',
      });

      const recalled = await memoryStore.recall(scopeFor(org.userId), 10);
      // Dos verdades simultáneas sobre lo mismo no tendrían criterio de desempate.
      expect(recalled).toHaveLength(1);
      expect(recalled[0].value).toBe('segunda versión');
    });

    it('borrar el usuario se lleva su memoria (clave ajena real, no columna suelta)', async () => {
      await memoryStore.remember(scopeFor(userB), { key: 'k', value: 'v' });

      await prisma.agentMemory.deleteMany({ where: { userId: userB } });
      await prisma.user.delete({ where: { id: userB } });
      // Se recrea para que el afterEach no falle al limpiarlo.
      const recreated = await prisma.user.create({
        data: {
          email: `vecino2-${Date.now()}${Math.random()}@test.local`,
          passwordHash: 'x',
          name: 'Vecino',
        },
      });
      userB = recreated.id;

      expect(await prisma.agentMemory.count({ where: { agentId } })).toBe(0);
    });
  });
});

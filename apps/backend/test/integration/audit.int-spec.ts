import { MembershipRole } from '@businessbrain/database';
import { AuditService } from '../../src/audit/audit.service';
import { AUDIT_ACTIONS } from '../../src/audit/domain/audit-actions';
import { AgentsService } from '../../src/agents/application/agents.service';
import { AgentTemplatesService } from '../../src/agents/application/agent-templates.service';
import { InstallAgentTemplateUseCase } from '../../src/agents/application/install-agent-template.use-case';
import { CollectionAccessService } from '../../src/knowledge-engine/application/collection-access.service';
import { BusinessObjectiveService } from '../../src/understanding-engine/application/business-objective.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  auditService,
  createMember,
  createTestOrg,
  destroyTestOrg,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * Fase 6, subfase 6.2 — trazabilidad de auditoría.
 *
 * Lo que un doble no puede demostrar: que la entrada llega REALMENTE a Postgres con su actor,
 * su organización y su antes/después, que ningún secreto sobrevive al viaje, y que un fallo
 * al auditar no derriba la operación auditada.
 */
describe('Auditoría (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let audit: AuditService;
  let agents: AgentsService;
  let templates: AgentTemplatesService;
  let install: InstallAgentTemplateUseCase;
  let access: CollectionAccessService;
  let objectives: BusinessObjectiveService;

  beforeEach(async () => {
    org = await createTestOrg('audit-int');
    audit = auditService(db);
    agents = new AgentsService(db, audit);
    templates = new AgentTemplatesService(db, audit);
    install = new InstallAgentTemplateUseCase(templates, agents, audit);
    access = new CollectionAccessService(db, audit);
    objectives = new BusinessObjectiveService(db, audit);
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const logsFor = (action: string) =>
    prisma.auditLog.findMany({
      where: { organizationId: org.orgId, action },
      orderBy: { createdAt: 'asc' },
    });

  const createAgent = (overrides: Record<string, unknown> = {}) =>
    agents.create({
      organizationId: org.orgId,
      createdById: org.userId,
      name: 'Agente auditado',
      systemPrompt: 'Ayudas al equipo.',
      ...overrides,
    });

  // ── Agentes ───────────────────────────────────────────────────────────────
  describe('agentes', () => {
    it('crear un agente deja traza con actor, organización y lo concedido', async () => {
      const agent = await createAgent({
        tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
      });

      const [log] = await logsFor(AUDIT_ACTIONS.AGENT_CREATED);
      expect(log.actorId).toBe(org.userId);
      expect(log.organizationId).toBe(org.orgId);
      expect(log.targetId).toBe(agent.id);
      expect(log.metadata).toMatchObject({
        name: 'Agente auditado',
        tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
      });
    });

    it('modificar un agente registra ANTES y DESPUÉS, solo de lo que cambió', async () => {
      const agent = await createAgent();

      await agents.update({
        organizationId: org.orgId,
        agentId: agent.id,
        actorUserId: org.userId,
        name: 'Renombrado',
      });

      const [log] = await logsFor(AUDIT_ACTIONS.AGENT_UPDATED);
      const metadata = log.metadata as {
        before: Record<string, unknown>;
        after: Record<string, unknown>;
      };
      expect(metadata.before).toEqual({ name: 'Agente auditado' });
      expect(metadata.after).toEqual({ name: 'Renombrado' });
      // Lo que no cambió no ensucia la traza.
      expect(metadata.after.systemPrompt).toBeUndefined();
    });

    it('ampliar el alcance de conocimiento queda registrado como cambio', async () => {
      const collection = await prisma.knowledgeCollection.create({
        data: { organizationId: org.orgId, name: 'Ventas' },
      });
      const agent = await createAgent();

      await agents.update({
        organizationId: org.orgId,
        agentId: agent.id,
        actorUserId: org.userId,
        knowledgeCollectionIds: [collection.id],
      });

      const [log] = await logsFor(AUDIT_ACTIONS.AGENT_UPDATED);
      const metadata = log.metadata as { after: Record<string, unknown> };
      expect(metadata.after.knowledgeCollectionIds).toEqual([collection.id]);
    });

    it('una actualización que no cambia nada no genera ruido', async () => {
      const agent = await createAgent();

      await agents.update({
        organizationId: org.orgId,
        agentId: agent.id,
        actorUserId: org.userId,
        name: 'Agente auditado',
      });

      expect(await logsFor(AUDIT_ACTIONS.AGENT_UPDATED)).toHaveLength(0);
    });

    it('desactivar deja constancia de quién lo hizo', async () => {
      const agent = await createAgent();
      const admin = await createMember(org, MembershipRole.ADMIN);

      await agents.deactivate({
        organizationId: org.orgId,
        agentId: agent.id,
        actorUserId: admin,
      });

      const [log] = await logsFor(AUDIT_ACTIONS.AGENT_DEACTIVATED);
      expect(log.actorId).toBe(admin);
    });
  });

  // ── Plantillas ────────────────────────────────────────────────────────────
  describe('plantillas', () => {
    const createTemplate = () =>
      templates.create({
        organizationId: org.orgId,
        actorUserId: org.userId,
        name: 'Analista',
        description: 'Analiza ventas.',
        defaultSystemPrompt: 'Analizas ventas.',
      });

    it('crear, modificar, instalar y retirar dejan traza', async () => {
      const template = await createTemplate();
      await templates.update({
        organizationId: org.orgId,
        actorUserId: org.userId,
        templateId: template.id,
        name: 'Analista revisado',
      });
      const agent = await install.execute({
        organizationId: org.orgId,
        actorUserId: org.userId,
        templateId: template.id,
      });
      await templates.remove({
        organizationId: org.orgId,
        actorUserId: org.userId,
        templateId: template.id,
      });

      expect(await logsFor(AUDIT_ACTIONS.AGENT_TEMPLATE_CREATED)).toHaveLength(
        1,
      );
      expect(await logsFor(AUDIT_ACTIONS.AGENT_TEMPLATE_UPDATED)).toHaveLength(
        1,
      );
      expect(await logsFor(AUDIT_ACTIONS.AGENT_TEMPLATE_REMOVED)).toHaveLength(
        1,
      );

      // La instalación explica DE DÓNDE salieron los permisos del agente nuevo.
      const [installed] = await logsFor(AUDIT_ACTIONS.AGENT_TEMPLATE_INSTALLED);
      expect(installed.targetId).toBe(template.id);
      expect(installed.metadata).toMatchObject({ agentId: agent.id });
    });
  });

  // ── Permisos de conocimiento ──────────────────────────────────────────────
  describe('acceso a colecciones', () => {
    it('conceder y revocar quedan registrados: son cambios de permisos', async () => {
      const collection = await prisma.knowledgeCollection.create({
        data: { organizationId: org.orgId, name: 'RR. HH.' },
      });
      const member = await createMember(org, MembershipRole.MEMBER);

      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: collection.id,
        userId: member,
        grantedById: org.userId,
      });
      await access.revoke({
        organizationId: org.orgId,
        knowledgeCollectionId: collection.id,
        userId: member,
        actorUserId: org.userId,
      });

      const [granted] = await logsFor(AUDIT_ACTIONS.COLLECTION_ACCESS_GRANTED);
      expect(granted.actorId).toBe(org.userId);
      expect(granted.metadata).toMatchObject({ grantedToUserId: member });

      const [revoked] = await logsFor(AUDIT_ACTIONS.COLLECTION_ACCESS_REVOKED);
      expect(revoked.metadata).toMatchObject({ revokedFromUserId: member });
    });

    it('revocar lo que no estaba concedido no inventa una revocación', async () => {
      const collection = await prisma.knowledgeCollection.create({
        data: { organizationId: org.orgId, name: 'Ventas' },
      });
      const member = await createMember(org, MembershipRole.MEMBER);

      await access.revoke({
        organizationId: org.orgId,
        knowledgeCollectionId: collection.id,
        userId: member,
        actorUserId: org.userId,
      });

      expect(
        await logsFor(AUDIT_ACTIONS.COLLECTION_ACCESS_REVOKED),
      ).toHaveLength(0);
    });
  });

  // ── Objetivos de negocio ──────────────────────────────────────────────────
  describe('objetivos de negocio', () => {
    it('declarar, confirmar y descartar dejan traza con su actor', async () => {
      const objective = await objectives.declare({
        organizationId: org.orgId,
        statement: 'Margen por encima del 30 %.',
        origin: 'MANUAL_DECLARATION',
        actorUserId: org.userId,
      });
      const admin = await createMember(org, MembershipRole.ADMIN);
      await objectives.discard({
        organizationId: org.orgId,
        businessObjectiveId: objective.id,
        actorUserId: admin,
      });

      const [declared] = await logsFor(
        AUDIT_ACTIONS.BUSINESS_OBJECTIVE_DECLARED,
      );
      expect(declared.actorId).toBe(org.userId);

      // El esquema no guarda quién descartó; la traza sí. Un ancla de juicio de valor no
      // puede retirarse sin autor.
      const [discarded] = await logsFor(
        AUDIT_ACTIONS.BUSINESS_OBJECTIVE_DISCARDED,
      );
      expect(discarded.actorId).toBe(admin);
      expect(discarded.metadata).toMatchObject({
        before: { status: 'CONFIRMED' },
        after: { status: 'DISCARDED' },
      });
    });
  });

  // ── Secretos ──────────────────────────────────────────────────────────────
  describe('ningún secreto llega al registro', () => {
    it('redacta claves secretas antes de persistir', async () => {
      await audit.record({
        organizationId: org.orgId,
        actorId: org.userId,
        action: AUDIT_ACTIONS.AGENT_CREATED,
        metadata: {
          name: 'visible',
          apiKeyEnc: 'sk-ant-secreta-de-verdad',
          nested: { password: 'hunter2', configEnc: 'cifrado' },
        },
      });

      const [log] = await logsFor(AUDIT_ACTIONS.AGENT_CREATED);
      const serialized = JSON.stringify(log.metadata);
      expect(serialized).not.toContain('sk-ant-secreta-de-verdad');
      expect(serialized).not.toContain('hunter2');
      expect(serialized).not.toContain('cifrado');
      expect(serialized).toContain('visible');
    });

    it('un agente con perfil de LLM no filtra la clave por la traza', async () => {
      const profile = await prisma.llmProfile.create({
        data: {
          organizationId: org.orgId,
          provider: 'OPENAI',
          modelName: 'gpt-4.1',
          apiKeyEnc: 'clave-byo-del-cliente',
        },
      });

      await createAgent({ llmProfileId: profile.id });

      const logs = await prisma.auditLog.findMany({
        where: { organizationId: org.orgId },
      });
      expect(JSON.stringify(logs)).not.toContain('clave-byo-del-cliente');
    });
  });

  // ── Robustez ──────────────────────────────────────────────────────────────
  describe('registrar nunca rompe la operación auditada', () => {
    it('un fallo al auditar no propaga el error', async () => {
      const rota = new AuditService({
        auditLog: {
          create: () => Promise.reject(new Error('Postgres caído')),
        },
      } as unknown as PrismaService);

      // La operación ya ocurrió: lanzar aquí devolvería un error por algo que sí se hizo.
      await expect(
        rota.record({
          organizationId: org.orgId,
          actorId: org.userId,
          action: AUDIT_ACTIONS.AGENT_CREATED,
        }),
      ).resolves.toBeUndefined();
    });

    it('una operación de negocio sobrevive a una auditoría caída', async () => {
      const agentsConAuditoriaRota = new AgentsService(
        db,
        new AuditService({
          auditLog: {
            create: () => Promise.reject(new Error('Postgres caído')),
          },
        } as unknown as PrismaService),
      );

      const agent = await agentsConAuditoriaRota.create({
        organizationId: org.orgId,
        createdById: org.userId,
        name: 'Sobrevive',
        systemPrompt: 'x',
      });

      expect(agent.id).toBeTruthy();
      expect(
        await prisma.agent.findUnique({ where: { id: agent.id } }),
      ).not.toBeNull();
    });
  });

  // ── Aislamiento ───────────────────────────────────────────────────────────
  describe('aislamiento entre organizaciones', () => {
    it('la traza de una organización no aparece en la de otra', async () => {
      const other = await createTestOrg('audit-int-b');
      await new AgentsService(db, auditService(db)).create({
        organizationId: other.orgId,
        createdById: other.userId,
        name: 'Agente ajeno',
        systemPrompt: 'x',
      });

      expect(await logsFor(AUDIT_ACTIONS.AGENT_CREATED)).toHaveLength(0);
      expect(
        await prisma.auditLog.findMany({
          where: { organizationId: other.orgId },
        }),
      ).toHaveLength(1);

      await destroyTestOrg(other);
    });
  });
});

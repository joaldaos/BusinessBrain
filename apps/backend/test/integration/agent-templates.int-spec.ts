import {
  AgentArea,
  AgentTemplateVisibility,
  MembershipRole,
} from '@businessbrain/database';
import { AgentsService } from '../../src/agents/application/agents.service';
import { AgentTemplatesService } from '../../src/agents/application/agent-templates.service';
import { InstallAgentTemplateUseCase } from '../../src/agents/application/install-agent-template.use-case';
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
 * Fase 5, subfase 5.7 — catálogo de plantillas e instalación.
 *
 * Lo que un doble no puede demostrar: que el catálogo se acota contra la organización REAL,
 * que la autorización se resuelve leyendo la membresía persistida, y que una instalación
 * rechazada no deja un `Agent` a medias. Instalar una plantilla concede capacidades y
 * herramientas; si esa concesión se puede desbordar hacia otro tenant o hacia un usuario sin
 * permisos, todo lo que venga después hereda el fallo.
 */
describe('AgentTemplates (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let templates: AgentTemplatesService;
  let agents: AgentsService;
  let install: InstallAgentTemplateUseCase;

  beforeEach(async () => {
    org = await createTestOrg('tpl-int');
    templates = new AgentTemplatesService(db, auditService(db));
    agents = new AgentsService(db, auditService(db));
    install = new InstallAgentTemplateUseCase(
      templates,
      agents,
      auditService(db),
    );
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const baseTemplate = {
    name: 'Analista comercial',
    description: 'Responde preguntas del equipo de ventas sobre su cartera.',
    defaultSystemPrompt: 'Ayudas al equipo comercial con datos reales.',
  };

  const createTemplate = (
    target: TestOrg = org,
    overrides: Record<string, unknown> = {},
  ) =>
    templates.create({
      organizationId: target.orgId,
      actorUserId: target.userId,
      ...baseTemplate,
      ...overrides,
    });

  const createCollection = (target: TestOrg, name: string) =>
    prisma.knowledgeCollection.create({
      data: { organizationId: target.orgId, name },
    });

  // ── 1. Instalación válida ─────────────────────────────────────────────────
  describe('instalación válida', () => {
    it('instala una plantilla y copia sus defaults al agente', async () => {
      const template = await createTemplate(org, {
        area: AgentArea.SALES,
        defaultCapabilities: ['answer_questions', 'summarize'],
        defaultTools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
      });
      const collection = await createCollection(org, 'Ventas');

      const agent = await install.execute({
        organizationId: org.orgId,
        actorUserId: org.userId,
        templateId: template.id,
        knowledgeCollectionIds: [collection.id],
      });

      expect(agent.name).toBe('Analista comercial');
      expect(agent.area).toBe(AgentArea.SALES);
      expect(agent.systemPrompt).toBe(baseTemplate.defaultSystemPrompt);
      expect(agent.capabilities).toEqual(['answer_questions', 'summarize']);
      expect(agent.tools).toEqual([
        { tool: 'knowledge_search', permission: 'READ_ONLY' },
      ]);
      expect(agent.knowledgeCollections).toEqual([
        { id: collection.id, name: 'Ventas' },
      ]);
    });

    it('lo que la plantilla no declara NO se hereda: sin memoria y sin herramientas', async () => {
      const template = await createTemplate();

      const agent = await install.execute({
        organizationId: org.orgId,
        actorUserId: org.userId,
        templateId: template.id,
      });

      // Las capacidades se conceden, no se presuponen (invariante de 5.1).
      expect(agent.tools).toEqual([]);
      expect(agent.memoryConfig).toEqual({ strategy: 'none', windowSize: 10 });
      expect(agent.guardrails).toEqual({
        forbiddenTopics: [],
        escalateToHumanWhen: [],
        maxToolCallsPerRun: 5,
      });
    });

    it('permite sobrescribir nombre y system prompt sin tocar las capacidades', async () => {
      const template = await createTemplate(org, {
        defaultTools: [{ tool: 'insight_lookup', permission: 'READ_ONLY' }],
      });

      const agent = await install.execute({
        organizationId: org.orgId,
        actorUserId: org.userId,
        templateId: template.id,
        name: 'Analista de la zona norte',
        systemPrompt: 'Ayudas solo a la delegación norte.',
      });

      expect(agent.name).toBe('Analista de la zona norte');
      expect(agent.systemPrompt).toBe('Ayudas solo a la delegación norte.');
      // Lo concedido sigue siendo lo que la plantilla declaraba.
      expect(agent.tools).toEqual([
        { tool: 'insight_lookup', permission: 'READ_ONLY' },
      ]);
    });

    it('instalar dos veces produce dos agentes independientes', async () => {
      const template = await createTemplate();

      const first = await install.execute({
        organizationId: org.orgId,
        actorUserId: org.userId,
        templateId: template.id,
      });
      const second = await install.execute({
        organizationId: org.orgId,
        actorUserId: org.userId,
        templateId: template.id,
        name: 'Segunda instalación',
      });

      expect(first.id).not.toBe(second.id);
      expect(await agents.list({ organizationId: org.orgId })).toHaveLength(2);
    });

    it('instalar NO ejecuta el agente ni ninguna herramienta', async () => {
      const template = await createTemplate(org, {
        defaultTools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
      });

      await install.execute({
        organizationId: org.orgId,
        actorUserId: org.userId,
        templateId: template.id,
      });

      // Ni conversaciones ni rastro de ejecución: instalar deja un agente configurado.
      expect(
        await prisma.conversation.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: {
            organizationId: org.orgId,
            action: { startsWith: 'agent.tool' },
          },
        }),
      ).toBe(0);
    });
  });

  // ── 2. Plantilla de otra organización → 403 ───────────────────────────────
  describe('plantilla de otra organización', () => {
    it('instalar una plantilla ajena responde 403', async () => {
      const other = await createTestOrg('tpl-int-b');
      const theirs = await createTemplate(other, {
        visibility: AgentTemplateVisibility.ORGANIZATION,
      });

      await expect(
        install.execute({
          organizationId: org.orgId,
          actorUserId: org.userId,
          templateId: theirs.id,
        }),
      ).rejects.toMatchObject({ status: 403 });

      // Nada se persiste: el rechazo es previo a cualquier escritura.
      expect(await agents.list({ organizationId: org.orgId })).toHaveLength(0);

      await destroyTestOrg(other);
    });

    it('leer una plantilla ajena responde 403', async () => {
      const other = await createTestOrg('tpl-int-c');
      const theirs = await createTemplate(other);

      await expect(
        templates.findOne({
          organizationId: org.orgId,
          templateId: theirs.id,
        }),
      ).rejects.toMatchObject({ status: 403 });

      await destroyTestOrg(other);
    });

    it('modificar o retirar una plantilla ajena responde 403', async () => {
      const other = await createTestOrg('tpl-int-d');
      const theirs = await createTemplate(other);

      await expect(
        templates.update({
          organizationId: org.orgId,
          actorUserId: org.userId,
          templateId: theirs.id,
          name: 'secuestrada',
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        templates.remove({
          organizationId: org.orgId,
          actorUserId: org.userId,
          templateId: theirs.id,
        }),
      ).rejects.toMatchObject({ status: 403 });

      // Sobrevive intacta en su organización.
      const survivor = await prisma.agentTemplate.findUnique({
        where: { id: theirs.id },
      });
      expect(survivor?.name).toBe(baseTemplate.name);

      await destroyTestOrg(other);
    });

    it('una plantilla PUBLIC de otra organización TAMPOCO se instala en la Fase 5', async () => {
      const other = await createTestOrg('tpl-int-e');
      const theirs = await createTemplate(other, {
        visibility: AgentTemplateVisibility.PUBLIC,
      });

      // `PUBLIC` es groundwork del modelo, no un permiso efectivo: no hay marketplace, ni
      // moderación, ni revisión de contenido que respalde instalar configuración ajena.
      await expect(
        install.execute({
          organizationId: org.orgId,
          actorUserId: org.userId,
          templateId: theirs.id,
        }),
      ).rejects.toMatchObject({ status: 403 });

      await destroyTestOrg(other);
    });

    it('una plantilla de plataforma (sin publicador) no se distribuye en la Fase 5', async () => {
      const platform = await prisma.agentTemplate.create({
        data: {
          publisherOrgId: null,
          ...baseTemplate,
          area: AgentArea.GENERAL,
          visibility: AgentTemplateVisibility.PUBLIC,
        },
      });

      await expect(
        install.execute({
          organizationId: org.orgId,
          actorUserId: org.userId,
          templateId: platform.id,
        }),
      ).rejects.toMatchObject({ status: 403 });

      await prisma.agentTemplate.delete({ where: { id: platform.id } });
    });

    it('`AgentsService` rechaza un `templateId` ajeno aunque se le pase directamente', async () => {
      const other = await createTestOrg('tpl-int-f');
      const theirs = await createTemplate(other);

      // Defensa en profundidad: el único punto donde nace un `Agent` no acepta una
      // procedencia que apunte fuera del tenant, aunque el caso de uso se saltara.
      await expect(
        agents.create({
          organizationId: org.orgId,
          createdById: org.userId,
          name: 'Colado',
          systemPrompt: 'x',
          templateId: theirs.id,
        }),
      ).rejects.toThrow(/otra organización/i);

      await destroyTestOrg(other);
    });
  });

  // ── 3 y 4. Visibilidad PRIVATE y ORGANIZATION ─────────────────────────────
  describe('visibilidad', () => {
    it('una plantilla PRIVATE se usa dentro de su organización', async () => {
      const template = await createTemplate(org, {
        visibility: AgentTemplateVisibility.PRIVATE,
      });

      const agent = await install.execute({
        organizationId: org.orgId,
        actorUserId: org.userId,
        templateId: template.id,
      });

      expect(agent.templateId).toBe(template.id);
    });

    it('una plantilla PRIVATE no sale de su organización', async () => {
      const other = await createTestOrg('tpl-int-g');
      const theirs = await createTemplate(other, {
        visibility: AgentTemplateVisibility.PRIVATE,
      });

      await expect(
        install.execute({
          organizationId: org.orgId,
          actorUserId: org.userId,
          templateId: theirs.id,
        }),
      ).rejects.toMatchObject({ status: 403 });

      await destroyTestOrg(other);
    });

    it('una plantilla ORGANIZATION la instala cualquier ADMIN de esa organización', async () => {
      const template = await createTemplate(org, {
        visibility: AgentTemplateVisibility.ORGANIZATION,
      });
      // Un ADMIN distinto del que publicó la plantilla.
      const otherAdmin = await createMember(org, MembershipRole.ADMIN);

      const agent = await install.execute({
        organizationId: org.orgId,
        actorUserId: otherAdmin,
        templateId: template.id,
      });

      expect(agent.templateId).toBe(template.id);
      expect(agent.createdById).toBe(otherAdmin);
    });

    it('una plantilla ORGANIZATION no la instala un usuario de otra organización', async () => {
      const template = await createTemplate(org, {
        visibility: AgentTemplateVisibility.ORGANIZATION,
      });
      const other = await createTestOrg('tpl-int-h');

      // Sin membresía en esta organización no hay permiso, aunque sea OWNER en la suya.
      await expect(
        install.execute({
          organizationId: org.orgId,
          actorUserId: other.userId,
          templateId: template.id,
        }),
      ).rejects.toMatchObject({ status: 403 });

      await destroyTestOrg(other);
    });
  });

  // ── 5. Configuración inválida de plantilla → instalación rechazada ────────
  describe('configuración inválida', () => {
    it('RECHAZA crear una plantilla con una herramienta inexistente', async () => {
      await expect(
        createTemplate(org, {
          defaultTools: [{ tool: 'borrar_todo', permission: 'AUTONOMOUS' }],
        }),
      ).rejects.toThrow(/borrar_todo/);

      expect(await templates.list({ organizationId: org.orgId })).toHaveLength(
        0,
      );
    });

    it('RECHAZA la instalación si el JSON de la plantilla es inválido en base de datos', async () => {
      // Escrito directamente contra la base de datos: simula una plantilla creada con otra
      // versión del catálogo de herramientas. La instalación NO puede confiar en ella.
      const corrupt = await prisma.agentTemplate.create({
        data: {
          publisherOrgId: org.orgId,
          ...baseTemplate,
          area: AgentArea.GENERAL,
          defaultTools: [{ tool: 'send_email', permission: 'READ_ONLY' }],
        },
      });

      await expect(
        install.execute({
          organizationId: org.orgId,
          actorUserId: org.userId,
          templateId: corrupt.id,
        }),
      ).rejects.toThrow(/send_email/);

      // La instalación rechazada no deja ningún agente a medias.
      expect(
        await agents.list({ organizationId: org.orgId, includeInactive: true }),
      ).toHaveLength(0);
    });

    it('RECHAZA una plantilla con una capacidad desconocida', async () => {
      const corrupt = await prisma.agentTemplate.create({
        data: {
          publisherOrgId: org.orgId,
          ...baseTemplate,
          area: AgentArea.GENERAL,
          defaultCapabilities: ['tomar_decisiones_por_su_cuenta'],
        },
      });

      await expect(
        install.execute({
          organizationId: org.orgId,
          actorUserId: org.userId,
          templateId: corrupt.id,
        }),
      ).rejects.toThrow(/tomar_decisiones_por_su_cuenta/);
    });

    it('RECHAZA instalar con una colección de otra organización', async () => {
      const template = await createTemplate();
      const other = await createTestOrg('tpl-int-i');
      const theirCollection = await createCollection(other, 'RR. HH. ajeno');

      await expect(
        install.execute({
          organizationId: org.orgId,
          actorUserId: org.userId,
          templateId: template.id,
          knowledgeCollectionIds: [theirCollection.id],
        }),
      ).rejects.toThrow(/otra organización/i);

      await destroyTestOrg(other);
    });

    it('acepta `sql_query` declarada READ_ONLY: se conserva pero no tiene adaptador', async () => {
      const template = await createTemplate(org, {
        defaultTools: [{ tool: 'sql_query', permission: 'READ_ONLY' }],
      });

      const agent = await install.execute({
        organizationId: org.orgId,
        actorUserId: org.userId,
        templateId: template.id,
      });

      expect(agent.tools).toEqual([
        { tool: 'sql_query', permission: 'READ_ONLY' },
      ]);
    });
  });

  // ── 6. El agente creado conserva `templateId` ─────────────────────────────
  describe('trazabilidad de la procedencia', () => {
    it('el agente instalado conserva `templateId` y es legible desde la base de datos', async () => {
      const template = await createTemplate();

      const agent = await install.execute({
        organizationId: org.orgId,
        actorUserId: org.userId,
        templateId: template.id,
      });

      const persisted = await prisma.agent.findUnique({
        where: { id: agent.id },
        include: { template: true },
      });
      expect(persisted?.templateId).toBe(template.id);
      expect(persisted?.template?.name).toBe(baseTemplate.name);
    });

    it('un agente creado a mano NO tiene `templateId`', async () => {
      const agent = await agents.create({
        organizationId: org.orgId,
        createdById: org.userId,
        name: 'A mano',
        systemPrompt: 'x',
      });

      expect(agent.templateId).toBeNull();
    });

    it('`templateId` sobrevive a una actualización del agente', async () => {
      const template = await createTemplate();
      const agent = await install.execute({
        organizationId: org.orgId,
        actorUserId: org.userId,
        templateId: template.id,
      });

      const updated = await agents.update({
        organizationId: org.orgId,
        actorUserId: org.userId,
        agentId: agent.id,
        name: 'Renombrado tras instalar',
      });

      expect(updated.templateId).toBe(template.id);
    });

    it('actualizar la plantilla incrementa su versión: el agente instaló otra cosa', async () => {
      const template = await createTemplate();
      expect(template.version).toBe(1);

      const updated = await templates.update({
        organizationId: org.orgId,
        actorUserId: org.userId,
        templateId: template.id,
        defaultSystemPrompt: 'Instrucciones revisadas.',
      });

      expect(updated.version).toBe(2);
    });
  });

  // ── 7. Un usuario sin permisos no puede instalar ni modificar plantillas ──
  describe('autorización', () => {
    it.each([MembershipRole.VIEWER, MembershipRole.MEMBER])(
      'un %s no puede instalar una plantilla',
      async (role) => {
        const template = await createTemplate();
        const weak = await createMember(org, role);

        await expect(
          install.execute({
            organizationId: org.orgId,
            actorUserId: weak,
            templateId: template.id,
          }),
        ).rejects.toMatchObject({ status: 403 });

        expect(await agents.list({ organizationId: org.orgId })).toHaveLength(
          0,
        );
      },
    );

    it.each([MembershipRole.VIEWER, MembershipRole.MEMBER])(
      'un %s no puede crear, modificar ni retirar plantillas',
      async (role) => {
        const template = await createTemplate();
        const weak = await createMember(org, role);

        await expect(
          templates.create({
            organizationId: org.orgId,
            actorUserId: weak,
            ...baseTemplate,
          }),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          templates.update({
            organizationId: org.orgId,
            actorUserId: weak,
            templateId: template.id,
            name: 'renombrada sin permiso',
          }),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          templates.remove({
            organizationId: org.orgId,
            actorUserId: weak,
            templateId: template.id,
          }),
        ).rejects.toMatchObject({ status: 403 });

        const survivor = await prisma.agentTemplate.findUnique({
          where: { id: template.id },
        });
        expect(survivor?.name).toBe(baseTemplate.name);
      },
    );

    it('un usuario sin membresía en la organización no puede instalar', async () => {
      const template = await createTemplate();
      const stranger = await prisma.user.create({
        data: {
          email: `stranger-${Date.now()}@test.local`,
          passwordHash: 'x',
          name: 'Sin membresía',
        },
      });
      org.extraUserIds.push(stranger.id);

      await expect(
        install.execute({
          organizationId: org.orgId,
          actorUserId: stranger.id,
          templateId: template.id,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('un ADMIN sí puede: la denegación es por rol, no por un fallo general', async () => {
      const template = await createTemplate();
      const admin = await createMember(org, MembershipRole.ADMIN);

      const agent = await install.execute({
        organizationId: org.orgId,
        actorUserId: admin,
        templateId: template.id,
      });

      expect(agent.templateId).toBe(template.id);
    });
  });

  // ── 8. Ningún dato de otra organización aparece en el catálogo ────────────
  describe('aislamiento del catálogo', () => {
    it('el catálogo solo muestra plantillas de la propia organización', async () => {
      const mine = await createTemplate(org, { name: 'Mía' });
      const other = await createTestOrg('tpl-int-j');
      await createTemplate(other, { name: 'Ajena PRIVATE' });
      await createTemplate(other, {
        name: 'Ajena ORGANIZATION',
        visibility: AgentTemplateVisibility.ORGANIZATION,
      });
      await createTemplate(other, {
        name: 'Ajena PUBLIC',
        visibility: AgentTemplateVisibility.PUBLIC,
      });

      const catalog = await templates.list({ organizationId: org.orgId });

      expect(catalog).toHaveLength(1);
      expect(catalog[0].id).toBe(mine.id);
      expect(catalog.map((t) => t.publisherOrgId)).toEqual([org.orgId]);

      await destroyTestOrg(other);
    });

    it('una plantilla de plataforma tampoco aparece en el catálogo de la Fase 5', async () => {
      const platform = await prisma.agentTemplate.create({
        data: {
          publisherOrgId: null,
          ...baseTemplate,
          area: AgentArea.GENERAL,
          visibility: AgentTemplateVisibility.PUBLIC,
        },
      });

      expect(await templates.list({ organizationId: org.orgId })).toHaveLength(
        0,
      );

      await prisma.agentTemplate.delete({ where: { id: platform.id } });
    });

    it('los filtros del catálogo no abren una vía a plantillas ajenas', async () => {
      const other = await createTestOrg('tpl-int-k');
      await createTemplate(other, {
        area: AgentArea.FINANCE,
        visibility: AgentTemplateVisibility.PUBLIC,
      });

      // Filtrar por los atributos exactos de la plantilla ajena no la hace aparecer.
      expect(
        await templates.list({
          organizationId: org.orgId,
          area: AgentArea.FINANCE,
          visibility: AgentTemplateVisibility.PUBLIC,
        }),
      ).toHaveLength(0);

      await destroyTestOrg(other);
    });

    it('retirar una plantilla no borra los agentes ya instalados', async () => {
      const template = await createTemplate();
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

      // `onDelete: SetNull`: el agente pierde la referencia, no su configuración.
      const survivor = await prisma.agent.findUnique({
        where: { id: agent.id },
      });
      expect(survivor).not.toBeNull();
      expect(survivor?.templateId).toBeNull();
      expect(survivor?.systemPrompt).toBe(baseTemplate.defaultSystemPrompt);
    });
  });
});

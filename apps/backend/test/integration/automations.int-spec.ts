import {
  AutomationStatus,
  AutomationTriggerType,
  MembershipRole,
  RunStatus,
} from '@businessbrain/database';
import { BadRequestException } from '@nestjs/common';
import { AutomationsService } from '../../src/automations/application/automations.service';
import { AutomationSchedulerService } from '../../src/automations/application/automation-scheduler.service';
import { RunAutomationUseCase } from '../../src/automations/application/run-automation.use-case';
import { CronSchedulerAdapter } from '../../src/automations/infrastructure/cron-scheduler.adapter';
import { BusinessObjectiveService } from '../../src/understanding-engine/application/business-objective.service';
import { TriggerAnalysisRunUseCase } from '../../src/understanding-engine/application/trigger-analysis-run.use-case';
import { PrismaKnowledgeSignalsAdapter } from '../../src/understanding-engine/infrastructure/prisma-knowledge-signals.adapter';
import { KnowledgeSignalStrategy } from '../../src/understanding-engine/infrastructure/strategies/knowledge-signal.strategy';
import type { GenerativeSynthesisStrategy } from '../../src/understanding-engine/infrastructure/strategies/generative-synthesis.strategy';
import { ReportsService } from '../../src/reports/application/reports.service';
import { ComposeReportUseCase } from '../../src/reports/application/compose-report.use-case';
import { PdfRenderer } from '../../src/reports/infrastructure/pdf-renderer';
import { RetrieveInsightsUseCase } from '../../src/understanding-engine/application/retrieve-insights.use-case';
import type { RetrieveContextUseCase } from '../../src/knowledge-engine/application/retrieve-context.use-case';
import { CollectionAccessService } from '../../src/knowledge-engine/application/collection-access.service';
import { IngestFromSourceUseCase } from '../../src/knowledge-engine/application/ingest-from-source.use-case';
import type { ClassifyContentUseCase } from '../../src/knowledge-engine/application/classify-content.use-case';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  auditService,
  proposeFromInsights,
  chunkAndEmbed,
  connectorRegistry,
  restrictedPerimeter,
  createKnowledgeItem,
  createMember,
  createTestOrg,
  destroyTestOrg,
  prisma,
  subjectIdentity,
  encryptionService,
  type TestOrg,
  operationalAlerts,
} from './fixtures';

/**
 * El reloj, contra Postgres real — fase 6.
 *
 * Lo que un doble no puede demostrar: que dos instancias del backend no disparen la misma
 * automatización, y que un análisis lanzado sin nadie delante produzca comprensión de verdad.
 */
describe('Automatizaciones (integración)', () => {
  const db = prisma as unknown as PrismaService;
  const scheduler = new CronSchedulerAdapter();
  let org: TestOrg;
  let service: AutomationsService;
  let runner: RunAutomationUseCase;
  let clock: AutomationSchedulerService;
  let reports: ReportsService;

  const noGenerative = {
    key: 'generative-synthesis',
    version: '1.0.0',
    kind: 'GENERATIVE' as const,
    baseReliability: 0.6,
    producibleTypes: [],
    generate: () => Promise.resolve([]),
  } as unknown as GenerativeSynthesisStrategy;

  beforeAll(() => {
    const connectors = connectorRegistry();
    service = new AutomationsService(
      db,
      auditService(db),
      scheduler,
      connectors,
    );
    reports = new ReportsService(
      db,
      auditService(db),
      new ComposeReportUseCase(
        new RetrieveInsightsUseCase(db),
        {
          execute: () => Promise.resolve([]),
        } as unknown as RetrieveContextUseCase,
        new CollectionAccessService(db, auditService(db)),
      ),
      new PdfRenderer(),
    );
    runner = new RunAutomationUseCase(
      db,
      auditService(db),
      new TriggerAnalysisRunUseCase(
        db,
        new PrismaKnowledgeSignalsAdapter(db),
        new KnowledgeSignalStrategy(),
        new BusinessObjectiveService(db, auditService(db)),
        noGenerative,
        auditService(db),
        subjectIdentity(db),
        proposeFromInsights(db),
        operationalAlerts(db),
      ),
      reports,
      new IngestFromSourceUseCase(
        db,
        connectors,
        {
          execute: () =>
            Promise.resolve({ businessArea: null, tags: [], certainty: 0 }),
        } as unknown as ClassifyContentUseCase,
        encryptionService(),
        auditService(db),
        restrictedPerimeter(db, connectors),
        chunkAndEmbed(db),
        operationalAlerts(db),
      ),
    );
    clock = new AutomationSchedulerService(db, runner, scheduler);
  });

  beforeEach(async () => {
    org = await createTestOrg('automations');
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const crear = (overrides: Record<string, unknown> = {}) =>
    service.create({
      organizationId: org.orgId,
      actorUserId: org.userId,
      name: 'Barrido semanal',
      triggerType: AutomationTriggerType.SCHEDULE,
      triggerConfig: { cron: '0 8 * * 1', timezone: 'Europe/Madrid' },
      actions: [{ type: 'RUN_ANALYSIS' }],
      ...overrides,
    });

  describe('crear una automatización programada', () => {
    it('calcula cuándo toca y la deja lista para reclamarse', async () => {
      const automation = await crear();

      expect(automation.status).toBe(AutomationStatus.ACTIVE);
      expect(automation.nextRunAt).toBeInstanceOf(Date);
      expect(automation.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it('conceder ejecución desatendida deja TRAZA', async () => {
      const automation = await crear();

      const log = await prisma.auditLog.findFirst({
        where: {
          organizationId: org.orgId,
          action: 'automation.created',
          targetId: automation.id,
        },
      });
      expect(log).not.toBeNull();
      expect(log?.actorId).toBe(org.userId);
    });

    it('RECHAZA una acción fuera del catálogo cerrado', async () => {
      await expect(
        crear({ actions: [{ type: 'SEND_EMAIL', to: 'jefe@empresa.com' }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('RECHAZA un calendario que no puede ejecutarse', async () => {
      await expect(
        crear({ triggerConfig: { cron: 'cada lunes', timezone: 'UTC' } }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('una automatización MANUAL no tiene vencimiento: no se reclama nunca', async () => {
      const automation = await crear({
        triggerType: AutomationTriggerType.MANUAL,
        triggerConfig: {},
      });

      expect(automation.nextRunAt).toBeNull();
    });

    it('pausarla la retira del reloj; reanudarla la devuelve', async () => {
      const automation = await crear();

      const pausada = await service.update({
        organizationId: org.orgId,
        actorUserId: org.userId,
        automationId: automation.id,
        status: AutomationStatus.PAUSED,
      });
      expect(pausada.nextRunAt).toBeNull();

      const reanudada = await service.update({
        organizationId: org.orgId,
        actorUserId: org.userId,
        automationId: automation.id,
        status: AutomationStatus.ACTIVE,
      });
      // Pausar no pierde el calendario: se vuelve a calcular al reanudar.
      expect(reanudada.nextRunAt).toBeInstanceOf(Date);
    });

    it('retirar es baja lógica: el historial de lo ejecutado no desaparece', async () => {
      const automation = await crear();
      await runner.execute(automation);

      await service.remove({
        organizationId: org.orgId,
        actorUserId: org.userId,
        automationId: automation.id,
      });

      expect(
        await prisma.automationRun.count({
          where: { automationId: automation.id },
        }),
      ).toBe(1);
    });

    it('otra organización no ve la automatización', async () => {
      const automation = await crear();
      const otra = await createTestOrg('automations-otra');

      await expect(
        service.findOne({
          organizationId: otra.orgId,
          automationId: automation.id,
        }),
      ).rejects.toThrow(/no encontrada/i);

      await destroyTestOrg(otra);
    });
  });

  describe('el reloj dispara solo', () => {
    /** Deja la automatización vencida, como si hubiera llegado su hora. */
    const vencer = (automationId: string) =>
      prisma.automation.update({
        where: { id: automationId },
        data: { nextRunAt: new Date(Date.now() - 60_000) },
      });

    it('CRITERIO DE CIERRE: sin intervención humana produce comprensión nueva', async () => {
      // Conocimiento con la confianza bajo el piso: señal determinista.
      await createKnowledgeItem(org, { confidenceScore: 0.05 });
      const automation = await crear();
      await vencer(automation.id);

      const ejecutadas = await clock.runDueAutomations();

      expect(ejecutadas).toContain(automation.id);

      // Nadie pulsó nada y el sistema comprendió.
      const insights = await prisma.insight.count({
        where: { organizationId: org.orgId },
      });
      expect(insights).toBeGreaterThan(0);

      const run = await prisma.automationRun.findFirstOrThrow({
        where: { automationId: automation.id },
      });
      expect(run.status).toBe(RunStatus.SUCCESS);
      expect(run.finishedAt).toBeInstanceOf(Date);
      // El diario dice QUÉ hizo, no solo que terminó.
      expect(JSON.stringify(run.logs)).toMatch(/AnalysisRun/);

      // Y el análisis quedó marcado como barrido periódico, no como manual.
      const analysis = await prisma.analysisRun.findFirstOrThrow({
        where: { organizationId: org.orgId, trigger: 'PERIODIC_SWEEP' },
      });
      expect(analysis.status).toBe('SUCCESS');
    });

    it('reprograma al reclamar: no se dispara dos veces seguidas', async () => {
      const automation = await crear();
      await vencer(automation.id);

      await clock.runDueAutomations();
      const despues = await prisma.automation.findFirstOrThrow({
        where: { id: automation.id },
      });
      expect(despues.nextRunAt!.getTime()).toBeGreaterThan(Date.now());

      // Un segundo tic inmediato no encuentra nada vencido.
      expect(await clock.runDueAutomations()).toEqual([]);
    });

    it('CRÍTICO: dos barridos SIMULTÁNEOS la ejecutan UNA sola vez', async () => {
      // Es el caso de dos instancias del backend. Con un temporizador en memoria, cada
      // proceso habría disparado la suya.
      await createKnowledgeItem(org, { confidenceScore: 0.05 });
      const automation = await crear();
      await vencer(automation.id);

      const [unos, otros] = await Promise.all([
        clock.runDueAutomations(),
        clock.runDueAutomations(),
      ]);

      const reclamada = [...unos, ...otros].filter(
        (id) => id === automation.id,
      );
      expect(reclamada).toHaveLength(1);
      expect(
        await prisma.automationRun.count({
          where: { automationId: automation.id },
        }),
      ).toBe(1);
    });

    it('una automatización PAUSADA no se reclama aunque tenga fecha vencida', async () => {
      const automation = await crear();
      await prisma.automation.update({
        where: { id: automation.id },
        data: {
          status: AutomationStatus.PAUSED,
          nextRunAt: new Date(Date.now() - 60_000),
        },
      });

      expect(await clock.runDueAutomations()).not.toContain(automation.id);
    });

    it('una automatización MANUAL nunca la reclama el reloj', async () => {
      const automation = await crear({
        triggerType: AutomationTriggerType.MANUAL,
        triggerConfig: {},
      });
      await vencer(automation.id);

      expect(await clock.runDueAutomations()).not.toContain(automation.id);
    });

    it('el fallo de una organización no deja sin reloj a las demás', async () => {
      const otra = await createTestOrg('automations-vecina');
      await createKnowledgeItem(otra, { confidenceScore: 0.05 });

      // Esta tiene el calendario corrupto: no debería poder ocurrir, y aun así ocurre.
      const rota = await crear();
      await prisma.automation.update({
        where: { id: rota.id },
        data: {
          triggerConfig: { cron: 'basura' },
          nextRunAt: new Date(Date.now() - 60_000),
        },
      });

      const sana = await service.create({
        organizationId: otra.orgId,
        actorUserId: otra.userId,
        name: 'La de la vecina',
        triggerType: AutomationTriggerType.SCHEDULE,
        triggerConfig: { cron: '0 8 * * 1', timezone: 'UTC' },
        actions: [{ type: 'RUN_ANALYSIS' }],
      });
      await prisma.automation.update({
        where: { id: sana.id },
        data: { nextRunAt: new Date(Date.now() - 60_000) },
      });

      const ejecutadas = await clock.runDueAutomations();

      expect(ejecutadas).toContain(sana.id);
      // La rota deja de programarse en lugar de tumbar el barrido.
      const despues = await prisma.automation.findFirstOrThrow({
        where: { id: rota.id },
      });
      expect(despues.nextRunAt).toBeNull();

      await destroyTestOrg(otra);
    });
  });

  describe('GENERATE_REPORT: la cadena completa sin nadie delante', () => {
    const crearInforme = () =>
      reports.create({
        organizationId: org.orgId,
        actorUserId: org.userId,
        name: 'Resumen automatico',
        template: {
          sections: [{ type: 'INSIGHTS', title: 'Comprension', limit: 10 }],
        },
      });

    it('CRITERIO DE CIERRE: analisis y despues informe, ambos desatendidos', async () => {
      const item = await createKnowledgeItem(org, { confidenceScore: 0.05 });
      const collection = await prisma.knowledgeCollection.create({
        data: { organizationId: org.orgId, name: 'Ventas' },
      });
      await prisma.knowledgeItemCollection.create({
        data: {
          knowledgeItemId: item.id,
          knowledgeCollectionId: collection.id,
          organizationId: org.orgId,
        },
      });
      await new CollectionAccessService(db, auditService(db)).grant({
        organizationId: org.orgId,
        knowledgeCollectionId: collection.id,
        userId: org.userId,
        grantedById: org.userId,
      });

      const report = await crearInforme();
      const automation = await crear({
        actions: [
          { type: 'RUN_ANALYSIS' },
          { type: 'GENERATE_REPORT', reportId: report.id },
        ],
      });
      await prisma.automation.update({
        where: { id: automation.id },
        data: { nextRunAt: new Date(Date.now() - 60_000) },
      });

      expect(await clock.runDueAutomations()).toContain(automation.id);

      const run = await prisma.automationRun.findFirstOrThrow({
        where: { automationId: automation.id },
      });
      expect(run.status).toBe(RunStatus.SUCCESS);
      const diario = JSON.stringify(run.logs);
      expect(diario).toMatch(/AnalysisRun/);
      expect(diario).toMatch(/ReportRun/);
      // El PDF se genero y NO se guardo: eso seria un efecto que nadie pidio.
      expect(diario).toMatch(/NO almacenados/);

      const reportRun = await prisma.reportRun.findFirstOrThrow({
        where: { reportId: report.id },
      });
      expect(reportRun.status).toBe(RunStatus.SUCCESS);
      expect(reportRun.fileUrl).toBeNull();

      // El informe se genero con el alcance de quien creo la automatizacion, y la traza lo
      // deja escrito.
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'report.generated', targetId: report.id },
      });
      expect(log.actorId).toBe(org.userId);
      expect(
        log.metadata as { trigger: string; externalActionExecuted: boolean },
      ).toMatchObject({ trigger: 'AUTOMATION', externalActionExecuted: false });
    });

    it('RECHAZA apuntar al informe de OTRA organizacion', async () => {
      const otra = await createTestOrg('automations-ajena');
      const suyo = await reports.create({
        organizationId: otra.orgId,
        actorUserId: otra.userId,
        name: 'El de la vecina',
        template: { sections: [{ type: 'INSIGHTS', title: 'x', limit: 5 }] },
      });

      // Sin esto, el reloj generaria el informe de otro tenant de madrugada.
      await expect(
        crear({ actions: [{ type: 'GENERATE_REPORT', reportId: suyo.id }] }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await destroyTestOrg(otra);
    });

    it('RECHAZA apuntar a un informe inexistente', async () => {
      await expect(
        crear({
          actions: [{ type: 'GENERATE_REPORT', reportId: 'no-existe' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('en nombre de quién corre', () => {
    it('CRÍTICO: se DETIENE si quien la creó ya no pertenece a la organización', async () => {
      const miembro = await createMember(org, MembershipRole.ADMIN);
      const automation = await service.create({
        organizationId: org.orgId,
        actorUserId: miembro,
        name: 'La de quien se fue',
        triggerType: AutomationTriggerType.SCHEDULE,
        triggerConfig: { cron: '0 8 * * 1', timezone: 'UTC' },
        actions: [{ type: 'RUN_ANALYSIS' }],
      });

      // Esa persona deja la organización.
      await prisma.membership.deleteMany({
        where: { userId: miembro, organizationId: org.orgId },
      });

      const result = await runner.execute(automation);

      // Seguir ejecutando sería un mecanismo para que un acceso revocado produjera efectos
      // indefinidamente.
      expect(result.status).toBe(RunStatus.FAILED);
      const despues = await prisma.automation.findFirstOrThrow({
        where: { id: automation.id },
      });
      expect(despues.status).toBe(AutomationStatus.ERROR);
      expect(despues.nextRunAt).toBeNull();

      // Y no ejecutó ningún análisis.
      expect(
        await prisma.analysisRun.count({
          where: { organizationId: org.orgId, trigger: 'PERIODIC_SWEEP' },
        }),
      ).toBe(0);
    });

    it('el fallo queda explicado, no solo marcado', async () => {
      const miembro = await createMember(org, MembershipRole.ADMIN);
      const automation = await service.create({
        organizationId: org.orgId,
        actorUserId: miembro,
        name: 'La de quien se fue',
        triggerType: AutomationTriggerType.MANUAL,
        triggerConfig: {},
        actions: [{ type: 'RUN_ANALYSIS' }],
      });
      await prisma.membership.deleteMany({
        where: { userId: miembro, organizationId: org.orgId },
      });

      await runner.execute(automation);

      const run = await prisma.automationRun.findFirstOrThrow({
        where: { automationId: automation.id },
      });
      expect(run.error).toMatch(/ya no pertenece a la organización/i);
    });
  });

  describe('cada ejecución deja traza', () => {
    it('registra el fin de la ejecución SIN actor: no la provocó una persona', async () => {
      const automation = await crear();
      await runner.execute(automation);

      const log = await prisma.auditLog.findFirstOrThrow({
        where: {
          organizationId: org.orgId,
          action: 'automation.run.finished',
          targetId: automation.id,
        },
      });

      expect(log.actorId).toBeNull();
      // Una automatización jamás toca el mundo exterior, y la traza lo declara.
      expect(
        (log.metadata as { externalActionExecuted: boolean })
          .externalActionExecuted,
      ).toBe(false);
    });

    it('la ejecución actualiza lastRunAt', async () => {
      const automation = await crear();
      expect(automation.lastRunAt).toBeNull();

      await runner.execute(automation);

      const despues = await prisma.automation.findFirstOrThrow({
        where: { id: automation.id },
      });
      expect(despues.lastRunAt).toBeInstanceOf(Date);
    });
  });
});

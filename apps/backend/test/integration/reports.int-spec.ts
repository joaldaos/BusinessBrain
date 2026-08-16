import {
  InsightStatus,
  MembershipRole,
  RunStatus,
} from '@businessbrain/database';
import { BadRequestException } from '@nestjs/common';
import { ReportsService } from '../../src/reports/application/reports.service';
import { ComposeReportUseCase } from '../../src/reports/application/compose-report.use-case';
import { PdfRenderer } from '../../src/reports/infrastructure/pdf-renderer';
import { RetrieveInsightsUseCase } from '../../src/understanding-engine/application/retrieve-insights.use-case';
import { RetrieveContextUseCase } from '../../src/knowledge-engine/application/retrieve-context.use-case';
import { CollectionAccessService } from '../../src/knowledge-engine/application/collection-access.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  auditService,
  createInsight,
  createKnowledgeItem,
  createMember,
  createTestOrg,
  destroyTestOrg,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * Informes contra Postgres real — fase 6.
 *
 * Un PDF es la forma más fácil de que una fuga sobreviva a los permisos: se descarga, se
 * reenvía y ya nadie vuelve a comprobar nada. Lo que se verifica aquí es que el alcance de 6.3
 * gobierne el contenido igual que gobierna `GET /insights`, y que la traza permita saber qué
 * contenía un fichero que no se ha guardado.
 */
describe('Informes (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let service: ReportsService;
  let access: CollectionAccessService;
  let baseCollectionId: string;

  beforeAll(() => {
    access = new CollectionAccessService(db, auditService(db));
    service = new ReportsService(
      db,
      auditService(db),
      new ComposeReportUseCase(
        new RetrieveInsightsUseCase(db),
        // El Retriever real necesita embeddings; estas pruebas verifican el ALCANCE sobre
        // comprensión, no el ranking semántico, que tiene su propia suite.
        {
          execute: () => Promise.resolve([]),
        } as unknown as RetrieveContextUseCase,
        access,
      ),
      new PdfRenderer(),
    );
  });

  beforeEach(async () => {
    org = await createTestOrg('reports');
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: org.orgId, name: 'Ventas' },
    });
    baseCollectionId = collection.id;
    await access.grant({
      organizationId: org.orgId,
      knowledgeCollectionId: baseCollectionId,
      userId: org.userId,
      grantedById: org.userId,
    });
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Conclusión sostenida por evidencia dentro de la colección indicada. */
  const seedInsight = async (params: {
    subjectIdentity: string;
    collectionId: string;
    confidence?: number;
  }) => {
    const item = await createKnowledgeItem(org, { title: 'Informe fuente' });
    await prisma.knowledgeItemCollection.create({
      data: {
        knowledgeItemId: item.id,
        knowledgeCollectionId: params.collectionId,
        organizationId: org.orgId,
      },
    });
    return createInsight(org, {
      subjectIdentity: params.subjectIdentity,
      status: InsightStatus.ACTIVE,
      confidence: params.confidence ?? 0.9,
      evidenceItemIds: [item.id],
    });
  };

  const crear = (template?: unknown) =>
    service.create({
      organizationId: org.orgId,
      actorUserId: org.userId,
      name: 'Resumen semanal',
      template: template ?? {
        sections: [
          { type: 'INSIGHTS', title: 'Qué hemos comprendido', limit: 10 },
        ],
      },
    });

  describe('definir un informe', () => {
    it('RECHAZA una plantilla con una consulta libre', async () => {
      await expect(
        crear({
          sections: [
            { type: 'SQL', title: 'x', sql: 'SELECT * FROM "Insight"' },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('otra organización no ve el informe', async () => {
      const report = await crear();
      const otra = await createTestOrg('reports-otra');

      await expect(
        service.findOne({ organizationId: otra.orgId, reportId: report.id }),
      ).rejects.toThrow(/no encontrado/i);

      await destroyTestOrg(otra);
    });
  });

  describe('generar', () => {
    it('produce un PDF real y NO lo almacena', async () => {
      await seedInsight({
        subjectIdentity: 'asunto-visible',
        collectionId: baseCollectionId,
      });
      const report = await crear();

      const generated = await service.generate({
        organizationId: org.orgId,
        actorUserId: org.userId,
        reportId: report.id,
        trigger: 'MANUAL',
      });

      // Cabecera de un PDF de verdad, no un marcador.
      expect(generated.content.subarray(0, 5).toString()).toBe('%PDF-');
      expect(generated.content.length).toBeGreaterThan(500);
      expect(generated.fileName).toMatch(/\.pdf$/);

      const run = await prisma.reportRun.findFirstOrThrow({
        where: { id: generated.runId },
      });
      expect(run.status).toBe(RunStatus.SUCCESS);
      // El fichero no se guarda en ninguna parte.
      expect(run.fileUrl).toBeNull();
    });

    it('la traza dice QUÉ contenía un fichero que no se ha guardado', async () => {
      const insight = await seedInsight({
        subjectIdentity: 'asunto-trazable',
        collectionId: baseCollectionId,
      });
      const report = await crear();

      await service.generate({
        organizationId: org.orgId,
        actorUserId: org.userId,
        reportId: report.id,
        trigger: 'MANUAL',
      });

      const log = await prisma.auditLog.findFirstOrThrow({
        where: {
          organizationId: org.orgId,
          action: 'report.generated',
          targetId: report.id,
        },
      });
      const metadata = log.metadata as {
        scopeCollectionIds: string[];
        storedFile: boolean;
        externalActionExecuted: boolean;
        sections: { evidence: { refId: string }[] }[];
      };

      expect(metadata.storedFile).toBe(false);
      expect(metadata.externalActionExecuted).toBe(false);
      expect(metadata.scopeCollectionIds).toEqual([baseCollectionId]);
      // Evidencia exacta: se puede saber qué se leyó sin conservar el PDF.
      expect(metadata.sections[0].evidence).toContainEqual({
        kind: 'INSIGHT',
        refId: insight.id,
      });
    });

    it('un fallo deja el ReportRun en FAILED con su motivo', async () => {
      const report = await crear();
      // Plantilla corrompida después de crearse: no debería poder ocurrir, y ocurre.
      await prisma.report.update({
        where: { id: report.id },
        data: { template: { sections: [{ type: 'SQL' }] } },
      });

      await expect(
        service.generate({
          organizationId: org.orgId,
          actorUserId: org.userId,
          reportId: report.id,
          trigger: 'MANUAL',
        }),
      ).rejects.toThrow();

      const run = await prisma.reportRun.findFirstOrThrow({
        where: { reportId: report.id },
      });
      expect(run.status).toBe(RunStatus.FAILED);
      expect(run.error).toBeTruthy();
    });
  });

  describe('CRÍTICO: el alcance gobierna el contenido', () => {
    it('no incluye comprensión que el lector no puede ver', async () => {
      const visible = await seedInsight({
        subjectIdentity: 'asunto-de-ventas',
        collectionId: baseCollectionId,
      });
      const rrhh = await prisma.knowledgeCollection.create({
        data: { organizationId: org.orgId, name: 'RR. HH.' },
      });
      const reservado = await seedInsight({
        subjectIdentity: 'asunto-de-rrhh',
        collectionId: rrhh.id,
      });

      const report = await crear();
      const generated = await service.generate({
        organizationId: org.orgId,
        actorUserId: org.userId,
        reportId: report.id,
        trigger: 'MANUAL',
      });

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'report.generated', targetId: report.id },
      });
      const evidencia = JSON.stringify(
        (log.metadata as { sections: unknown[] }).sections,
      );
      expect(evidencia).toContain(visible.id);
      expect(evidencia).not.toContain(reservado.id);
      expect(generated.content.length).toBeGreaterThan(0);
    });

    it('un lector SIN concesiones recibe un informe vacío, no uno completo', async () => {
      await seedInsight({
        subjectIdentity: 'asunto-acotado',
        collectionId: baseCollectionId,
      });
      const report = await crear();
      const sinAcceso = await createMember(org, MembershipRole.MEMBER);

      await service.generate({
        organizationId: org.orgId,
        actorUserId: sinAcceso,
        reportId: report.id,
        trigger: 'MANUAL',
      });

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'report.generated', actorId: sinAcceso },
      });
      const metadata = log.metadata as {
        scopeCollectionIds: string[];
        sections: { items: number; evidence: unknown[] }[];
      };

      // Alcance vacío significa NADA, jamás "todo".
      expect(metadata.scopeCollectionIds).toEqual([]);
      expect(metadata.sections[0].items).toBe(0);
      expect(metadata.sections[0].evidence).toEqual([]);
    });

    it('el mismo informe da contenidos DISTINTOS a personas distintas', async () => {
      await seedInsight({
        subjectIdentity: 'asunto-de-ventas',
        collectionId: baseCollectionId,
      });
      const report = await crear();
      const otroMiembro = await createMember(org, MembershipRole.MEMBER);

      const conAcceso = await service.generate({
        organizationId: org.orgId,
        actorUserId: org.userId,
        reportId: report.id,
        trigger: 'MANUAL',
      });
      const sinAcceso = await service.generate({
        organizationId: org.orgId,
        actorUserId: otroMiembro,
        reportId: report.id,
        trigger: 'MANUAL',
      });

      // Exactamente la misma regla que al leer `GET /insights`.
      expect(conAcceso.content.length).toBeGreaterThan(
        sinAcceso.content.length,
      );
    });
  });

  describe('la comprensión viaja con sus condiciones', () => {
    it('una versión SUPERADA no aparece: se lee por RetrieveInsights, no por consulta propia', async () => {
      const superada = await seedInsight({
        subjectIdentity: 'asunto-versionado',
        collectionId: baseCollectionId,
      });
      await prisma.insight.update({
        where: { id: superada.id },
        data: { status: InsightStatus.SUPERSEDED },
      });

      const report = await crear();
      await service.generate({
        organizationId: org.orgId,
        actorUserId: org.userId,
        reportId: report.id,
        trigger: 'MANUAL',
      });

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'report.generated', targetId: report.id },
      });
      expect(JSON.stringify(log.metadata)).not.toContain(superada.id);
    });

    it('el piso de confianza de la sección se aplica', async () => {
      await seedInsight({
        subjectIdentity: 'asunto-debil',
        collectionId: baseCollectionId,
        confidence: 0.3,
      });
      const report = await crear({
        sections: [
          {
            type: 'INSIGHTS',
            title: 'Solo lo sólido',
            limit: 10,
            minimumConfidence: 0.8,
          },
        ],
      });

      await service.generate({
        organizationId: org.orgId,
        actorUserId: org.userId,
        reportId: report.id,
        trigger: 'MANUAL',
      });

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'report.generated', targetId: report.id },
      });
      expect(
        (log.metadata as { sections: { items: number }[] }).sections[0].items,
      ).toBe(0);
    });
  });
});

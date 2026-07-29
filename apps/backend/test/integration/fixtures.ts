import {
  AnalysisRunStatus,
  AnalysisRunTrigger,
  ConnectionStatus,
  InsightStatus,
  InsightType,
  KnowledgeSourceType,
  PrismaClient,
} from '@businessbrain/database';

/**
 * Utilidades compartidas por los tests de integración.
 *
 * Estos tests se ejecutan contra Postgres REAL (con pgvector) y verifican garantías que un
 * doble no puede demostrar: índices parciales, restricciones CHECK, aislamiento entre
 * organizaciones y comportamiento bajo concurrencia. Por eso viven separados de los
 * unitarios (`npm run test:int`) y no se ejecutan en `npm test`.
 */

export const prisma = new PrismaClient();

export interface TestOrg {
  orgId: string;
  userId: string;
  sourceId: string;
  analysisRunId: string;
}

/** Crea una organización aislada. Cada test siembra la suya y la elimina al terminar. */
export async function createTestOrg(prefix: string): Promise<TestOrg> {
  const rnd = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

  const org = await prisma.organization.create({
    data: { name: prefix, slug: `${prefix}-${rnd}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `${prefix}-${rnd}@test.local`,
      passwordHash: 'x',
      name: 'Test',
    },
  });
  const source = await prisma.knowledgeSource.create({
    data: {
      organizationId: org.id,
      type: KnowledgeSourceType.FILE_UPLOAD,
      name: 'Fuente de prueba',
      connectorKey: 'file_upload_v1',
      createdById: user.id,
      status: ConnectionStatus.CONNECTED,
      configEnc: '',
    },
  });
  const run = await prisma.analysisRun.create({
    data: {
      organizationId: org.id,
      trigger: AnalysisRunTrigger.MANUAL,
      status: AnalysisRunStatus.SUCCESS,
    },
  });

  return {
    orgId: org.id,
    userId: user.id,
    sourceId: source.id,
    analysisRunId: run.id,
  };
}

/** El borrado en cascada de Organization arrastra todo lo demás. */
export async function destroyTestOrg(org: TestOrg): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: org.orgId } });
  await prisma.user.deleteMany({ where: { id: org.userId } });
}

export async function createKnowledgeItem(
  org: TestOrg,
  overrides: {
    title?: string;
    confidenceScore?: number;
    confidenceComputedAt?: Date;
    businessArea?:
      | 'HR'
      | 'MARKETING'
      | 'SALES'
      | 'FINANCE'
      | 'OPERATIONS'
      | 'SUPPORT'
      | 'GENERAL';
    status?: 'INDEXED' | 'SUPERSEDED' | 'DELETED';
  } = {},
) {
  return prisma.knowledgeItem.create({
    data: {
      organizationId: org.orgId,
      originKnowledgeSourceId: org.sourceId,
      currentKnowledgeSourceId: org.sourceId,
      title: overrides.title ?? 'Documento de prueba',
      contentText: 'contenido de prueba '.repeat(30),
      contentHash: `hash-${Math.random()}`,
      status: overrides.status ?? 'INDEXED',
      indexedAt: new Date(),
      businessArea: overrides.businessArea ?? 'GENERAL',
      confidenceScore: overrides.confidenceScore ?? 0.8,
      confidenceComputedAt:
        overrides.confidenceComputedAt ?? new Date('2026-01-01'),
    },
  });
}

export async function createInsight(
  org: TestOrg,
  params: {
    subjectIdentity: string;
    type?: InsightType;
    status?: InsightStatus;
    confidence?: number;
    confidenceComputedAt?: Date;
    evidenceItemIds?: string[];
  },
) {
  const evidenceIds = params.evidenceItemIds ?? [];

  const insight = await prisma.insight.create({
    data: {
      organizationId: org.orgId,
      analysisRunId: org.analysisRunId,
      subjectIdentity: params.subjectIdentity,
      type: params.type ?? InsightType.ANOMALY,
      summary: `Hallazgo sobre ${params.subjectIdentity}`,
      status: params.status ?? InsightStatus.ACTIVE,
      strategyKey: 'test-strategy',
      strategyVersion: '1.0.0',
      reasoningTrace: { rule: 'test' },
      confidence: params.confidence ?? 0.9,
      confidenceComputedAt:
        params.confidenceComputedAt ?? new Date('2026-06-01'),
      transitiveEvidenceClosure: evidenceIds.map((refId) => ({
        kind: 'KNOWLEDGE_ITEM',
        refId,
      })),
    },
  });

  for (const refId of evidenceIds) {
    await prisma.insightEvidence.create({
      data: {
        insightId: insight.id,
        kind: 'KNOWLEDGE_ITEM',
        role: 'BASELINE',
        knowledgeItemId: refId,
      },
    });
  }

  return insight;
}

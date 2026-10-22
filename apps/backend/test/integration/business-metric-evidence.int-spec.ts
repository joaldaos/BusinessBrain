import {
  InsightEvidenceKind,
  InsightEvidenceRole,
  InsightStatus,
  InsightType,
  Prisma,
} from '@businessbrain/database';
import {
  createTestOrg,
  destroyTestOrg,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * La evidencia de una conclusión sacada de hechos — Fase 9B.
 *
 * Sin esto, una conclusión sobre datos de un TPV sería la primera del producto **sin
 * respaldo**, y con ella caerían «Ver el detalle técnico», el anexo del PDF y la regla de no
 * afirmar sin evidencia.
 *
 * Esta migración RECREA una restricción ya desplegada —la que obliga a que la referencia
 * polimórfica case con `kind`—, que es el único cambio de la fase que toca una regla viva.
 * Por eso se comprueba contra Postgres y no se da por buena.
 */
describe('Métricas como evidencia (integración)', () => {
  let org: TestOrg;
  let insightId: string;
  let metricId: string;
  /**
   * Un documento REAL, creado aquí y no tomado de la fixture.
   *
   * La primera versión de estas pruebas lo buscaba con `findFirst` y se conformaba con
   * `null` si no había ninguno. Dos de ellas pasaban entonces por el motivo equivocado: la
   * restricción las rechazaba por venir SIN referencia, no por traer dos. Una prueba que
   * pasa por la razón contraria a la que dice es peor que no tenerla.
   */
  let knowledgeItemId: string;

  const VENTANA = {
    windowStart: new Date('2026-09-07T00:00:00.000Z'),
    windowEnd: new Date('2026-10-19T00:00:00.000Z'),
  };

  beforeEach(async () => {
    org = await createTestOrg('metric-evidence');

    const metric = await prisma.businessMetricWindow.create({
      data: {
        organizationId: org.orgId,
        metricKey: 'kitchen.prep_time_p50',
        dimensions: { weekday: 6, hourBucket: 21 },
        ...VENTANA,
        value: new Prisma.Decimal(24),
        sampleSize: 412,
      },
      select: { id: true },
    });
    metricId = metric.id;

    const documento = await prisma.knowledgeItem.create({
      data: {
        organizationId: org.orgId,
        originKnowledgeSourceId: org.sourceId,
        currentKnowledgeSourceId: org.sourceId,
        title: 'Protocolo de cocina',
        contentText: 'Si el tiempo de servicio sube, se refuerza cocina.',
        contentHash: `metric-evidence-${Date.now()}`,
        status: 'INDEXED',
        indexedAt: new Date(),
      },
      select: { id: true },
    });
    knowledgeItemId = documento.id;

    const insight = await prisma.insight.create({
      data: {
        organizationId: org.orgId,
        analysisRunId: org.analysisRunId,
        subjectIdentity: `cocina::sabado-noche::${Date.now()}`,
        type: InsightType.ANOMALY,
        status: InsightStatus.ACTIVE,
        summary: 'El tiempo de salida sube los sábados a mediodía',
        confidence: 0.9,
        confidenceComputedAt: new Date(),
        strategyKey: 'prueba',
        strategyVersion: '1.0.0',
        reasoningTrace: {},
        // El cierre de evidencia es obligatorio: una conclusión sin él no podría decir de
        // qué depende, que es lo que sostiene la supersesión y el historial de creencia.
        transitiveEvidenceClosure: [
          { kind: 'BUSINESS_METRIC', refId: metric.id },
        ],
      },
      select: { id: true },
    });
    insightId = insight.id;
  });

  afterEach(async () => {
    await prisma.insightEvidence.deleteMany({ where: { insightId } });
    await prisma.insight.deleteMany({ where: { organizationId: org.orgId } });
    await prisma.knowledgeItem.deleteMany({
      where: { organizationId: org.orgId },
    });
    await prisma.businessMetricWindow.deleteMany({
      where: { organizationId: org.orgId },
    });
    await destroyTestOrg(org);
  });

  it('una conclusión puede citar una métrica como evidencia', async () => {
    const evidencia = await prisma.insightEvidence.create({
      data: {
        insightId,
        kind: InsightEvidenceKind.BUSINESS_METRIC,
        role: InsightEvidenceRole.DEVIATION,
        businessMetricId: metricId,
      },
      include: { businessMetric: true },
    });

    expect(evidencia.businessMetric?.sampleSize).toBe(412);
    expect(evidencia.businessMetric?.value.toString()).toBe('24');
  });

  describe('la restricción recreada sigue siendo estricta', () => {
    const intentar = (data: Prisma.InsightEvidenceUncheckedCreateInput) =>
      prisma.insightEvidence.create({ data });

    it('BUSINESS_METRIC sin métrica se rechaza', async () => {
      await expect(
        intentar({
          insightId,
          kind: InsightEvidenceKind.BUSINESS_METRIC,
          role: InsightEvidenceRole.DEVIATION,
        }),
      ).rejects.toThrow();
    });

    /**
     * El caso que se escaparía si solo se hubiera AÑADIDO la rama nueva sin tocar las
     * viejas: una evidencia que dice ser un documento y trae además una métrica.
     */
    it('un documento que trae ADEMÁS una métrica se rechaza', async () => {
      await expect(
        intentar({
          insightId,
          kind: InsightEvidenceKind.KNOWLEDGE_ITEM,
          role: InsightEvidenceRole.BASELINE,
          knowledgeItemId,
          businessMetricId: metricId,
        }),
      ).rejects.toThrow();
    });

    it('una métrica que trae ADEMÁS un documento se rechaza', async () => {
      await expect(
        intentar({
          insightId,
          kind: InsightEvidenceKind.BUSINESS_METRIC,
          role: InsightEvidenceRole.DEVIATION,
          businessMetricId: metricId,
          knowledgeItemId,
        }),
      ).rejects.toThrow();
    });

    /** Y lo que SÍ debe entrar: un documento solo, como siempre. */
    it('un documento solo sigue siendo evidencia válida', async () => {
      const evidencia = await intentar({
        insightId,
        kind: InsightEvidenceKind.KNOWLEDGE_ITEM,
        role: InsightEvidenceRole.CORROBORATION,
        knowledgeItemId,
      });

      expect(evidencia.knowledgeItemId).toBe(knowledgeItemId);
    });

    it('CANONICAL_ENTITY sigue sin admitir ninguna referencia', async () => {
      await expect(
        intentar({
          insightId,
          kind: InsightEvidenceKind.CANONICAL_ENTITY,
          role: InsightEvidenceRole.CORROBORATION,
          businessMetricId: metricId,
        }),
      ).rejects.toThrow();
    });
  });

  describe('qué no puede ser una ventana de métrica', () => {
    const crear = (extra: Record<string, unknown>) =>
      prisma.businessMetricWindow.create({
        data: {
          organizationId: org.orgId,
          metricKey: 'prueba',
          ...VENTANA,
          value: new Prisma.Decimal(1),
          sampleSize: 10,
          ...extra,
        },
      });

    /**
     * `sampleSize` es lo que permite CALLARSE: una mediana sobre cero comandas no es una
     * medida floja, es ninguna medida. Dejarla entrar produciría una evidencia que parece
     * respaldo y no respalda.
     */
    it('una muestra vacía se rechaza', async () => {
      await expect(crear({ sampleSize: 0 })).rejects.toThrow();
      await expect(crear({ sampleSize: -3 })).rejects.toThrow();
    });

    it('una ventana que termina antes de empezar se rechaza', async () => {
      await expect(
        crear({
          windowStart: VENTANA.windowEnd,
          windowEnd: VENTANA.windowStart,
        }),
      ).rejects.toThrow();
    });
  });

  describe('trazabilidad', () => {
    /**
     * Borrar una ventana dejaría viva una conclusión sin la evidencia que la sostenía — que
     * es exactamente lo que este modelo existe para impedir.
     */
    it('no se puede borrar una métrica que sostiene una conclusión', async () => {
      await prisma.insightEvidence.create({
        data: {
          insightId,
          kind: InsightEvidenceKind.BUSINESS_METRIC,
          role: InsightEvidenceRole.DEVIATION,
          businessMetricId: metricId,
        },
      });

      await expect(
        prisma.businessMetricWindow.delete({ where: { id: metricId } }),
      ).rejects.toThrow();
    });

    it('recalcular la misma ventana la ACTUALIZA, no la duplica', async () => {
      const clave = {
        organizationId: org.orgId,
        metricKey: 'kitchen.prep_time_p50',
        dimensions: { weekday: 6, hourBucket: 21 },
        ...VENTANA,
      };

      await prisma.businessMetricWindow.update({
        where: { id: metricId },
        data: { value: new Prisma.Decimal(26), sampleSize: 480 },
      });

      const todas = await prisma.businessMetricWindow.findMany({
        where: {
          organizationId: clave.organizationId,
          metricKey: clave.metricKey,
        },
      });
      expect(todas).toHaveLength(1);
      expect(todas[0]?.sampleSize).toBe(480);
    });

    it('una ventana de otra empresa no se mezcla con la mía', async () => {
      const otra = await createTestOrg('metric-vecina');
      await prisma.businessMetricWindow.create({
        data: {
          organizationId: otra.orgId,
          metricKey: 'kitchen.prep_time_p50',
          dimensions: { weekday: 6, hourBucket: 21 },
          ...VENTANA,
          value: new Prisma.Decimal(99),
          sampleSize: 5,
        },
      });

      const mias = await prisma.businessMetricWindow.findMany({
        where: { organizationId: org.orgId },
      });
      expect(mias).toHaveLength(1);
      expect(mias[0]?.value.toString()).toBe('24');

      await prisma.businessMetricWindow.deleteMany({
        where: { organizationId: otra.orgId },
      });
      await destroyTestOrg(otra);
    });
  });
});

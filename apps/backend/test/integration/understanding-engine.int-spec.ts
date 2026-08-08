import {
  BusinessObjectiveOrigin,
  InsightFeedbackType,
  InsightStatus,
  InsightType,
} from '@businessbrain/database';
import { BusinessObjectiveService } from '../../src/understanding-engine/application/business-objective.service';
import { CurateInsightUseCase } from '../../src/understanding-engine/application/curate-insight.use-case';
import { RetrieveInsightsUseCase } from '../../src/understanding-engine/application/retrieve-insights.use-case';
import { TriggerAnalysisRunUseCase } from '../../src/understanding-engine/application/trigger-analysis-run.use-case';
import { PrismaKnowledgeSignalsAdapter } from '../../src/understanding-engine/infrastructure/prisma-knowledge-signals.adapter';
import { KnowledgeSignalStrategy } from '../../src/understanding-engine/infrastructure/strategies/knowledge-signal.strategy';
import type { GenerativeSynthesisStrategy } from '../../src/understanding-engine/infrastructure/strategies/generative-synthesis.strategy';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  createInsight,
  createKnowledgeItem,
  createTestOrg,
  destroyTestOrg,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * Tests de integración del Understanding Engine contra Postgres real.
 *
 * Verifican garantías que un doble NO puede demostrar: el índice único parcial de
 * idempotencia, el aislamiento entre organizaciones, y el comportamiento bajo concurrencia
 * real. Sustituyen a los smokes manuales que validaron estas subfases, dejando la
 * verificación en el repositorio y repetible.
 */

/** La estrategia generativa se anula: su comportamiento tiene su propia suite unitaria. */
const noGenerative = {
  key: 'generative-synthesis',
  version: '1.0.0',
  kind: 'GENERATIVE' as const,
  baseReliability: 0.6,
  producibleTypes: [],
  generate: () => Promise.resolve([]),
} as unknown as GenerativeSynthesisStrategy;

describe('Understanding Engine (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let objectives: BusinessObjectiveService;
  let curator: CurateInsightUseCase;
  let retriever: RetrieveInsightsUseCase;
  let trigger: TriggerAnalysisRunUseCase;

  beforeAll(() => {
    objectives = new BusinessObjectiveService(db);
    curator = new CurateInsightUseCase(db);
    retriever = new RetrieveInsightsUseCase(db);
    trigger = new TriggerAnalysisRunUseCase(
      db,
      new PrismaKnowledgeSignalsAdapter(db),
      new KnowledgeSignalStrategy(),
      objectives,
      noGenerative,
    );
  });

  beforeEach(async () => {
    org = await createTestOrg('ue-int');
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('3.1 — razonamiento sobre señales e idempotencia (§12)', () => {
    it('una fuente cuya confianza decae genera un ANOMALY trazable a la señal exacta', async () => {
      const item = await createKnowledgeItem(org, {
        title: 'Nota que decae',
        confidenceScore: 0.15, // por debajo del piso de plataforma (0.2)
      });

      const result = await trigger.execute({ organizationId: org.orgId });

      expect(result.status).toBe('SUCCESS');
      expect(result.insightsCreated).toBe(1);

      const insight = await prisma.insight.findFirstOrThrow({
        where: { organizationId: org.orgId },
        include: { evidence: true },
      });

      expect(insight.type).toBe(InsightType.ANOMALY);
      expect(insight.subjectIdentity).toBe(
        `confidence-decay:knowledge-item:${item.id}`,
      );
      // Confianza compuesta: cruda 1 × fiabilidad 0.9 de la estrategia simbólica (§9).
      expect(insight.confidence).toBeCloseTo(0.9, 4);
      // Trazable hasta el KnowledgeItem exacto que originó la señal (§10).
      expect(insight.evidence[0].knowledgeItemId).toBe(item.id);
      expect((insight.reasoningTrace as { rule: string }).rule).toBe(
        'confidenceScore <= minimumFloor',
      );
    });

    it('ejecutar dos veces no duplica: el segundo reconoce el sujeto como ya conocido', async () => {
      await createKnowledgeItem(org, { confidenceScore: 0.1 });

      const first = await trigger.execute({ organizationId: org.orgId });
      const second = await trigger.execute({ organizationId: org.orgId });

      expect(first.insightsCreated).toBe(1);
      expect(second.insightsCreated).toBe(0);
      expect(second.insightsAlreadyKnown).toBe(1);
      expect(
        await prisma.insight.count({ where: { organizationId: org.orgId } }),
      ).toBe(1);
    });

    it('TRES AnalysisRun concurrentes producen UN único Insight y ninguna ejecución falla', async () => {
      // Criterio decisivo de la subfase 3.1: la corrección bajo concurrencia la garantiza
      // el índice único parcial, no un bloqueo — varias ejecuciones simultáneas son
      // legítimas y no se serializan (§3.1, §12).
      await createKnowledgeItem(org, { confidenceScore: 0.05 });

      const runs = await Promise.all([
        trigger.execute({ organizationId: org.orgId }),
        trigger.execute({ organizationId: org.orgId }),
        trigger.execute({ organizationId: org.orgId }),
      ]);

      expect(runs.every((r) => r.status === 'SUCCESS')).toBe(true);
      expect(runs.reduce((sum, r) => sum + r.insightsCreated, 0)).toBe(1);
      expect(runs.reduce((sum, r) => sum + r.insightsAlreadyKnown, 0)).toBe(2);
      expect(
        await prisma.insight.count({ where: { organizationId: org.orgId } }),
      ).toBe(1);
    });

    it('una organización no ve señales de otra', async () => {
      const other = await createTestOrg('ue-int-other');
      await createKnowledgeItem(other, { confidenceScore: 0.05 });

      const result = await trigger.execute({ organizationId: org.orgId });

      expect(result.candidatesGenerated).toBe(0);
      await destroyTestOrg(other);
    });
  });

  describe('ResolveInsightConflict — reconciliación entre ejecuciones (§12, §9)', () => {
    it('una segunda ejecución de la MISMA estrategia no infla la confianza', async () => {
      // Repetir el mismo mecanismo no aporta evidencia independiente (§9): el asunto se
      // reconoce como ya conocido y la confianza no se mueve.
      await createKnowledgeItem(org, { confidenceScore: 0.1 });

      await trigger.execute({ organizationId: org.orgId });
      const first = await prisma.insight.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });

      await trigger.execute({ organizationId: org.orgId });
      const after = await prisma.insight.findFirstOrThrow({
        where: { id: first.id },
      });

      expect(after.confidence).toBe(first.confidence);
    });

    it('una estrategia independiente que confirma el mismo asunto SUBE la confianza', async () => {
      const item = await createKnowledgeItem(org, { confidenceScore: 0.1 });
      await trigger.execute({ organizationId: org.orgId });

      const before = await prisma.insight.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });

      // Otra estrategia llega al mismo sujeto desde evidencia distinta.
      const otherItem = await createKnowledgeItem(org, {
        title: 'Otra fuente',
      });
      const independent = {
        key: 'estrategia-independiente',
        version: '1.0.0',
        kind: 'SYMBOLIC' as const,
        baseReliability: 0.9,
        producibleTypes: [InsightType.ANOMALY],
        generate: () =>
          Promise.resolve([
            {
              subjectIdentity: before.subjectIdentity,
              type: InsightType.ANOMALY,
              summary: 'Mismo asunto, otra vía',
              evidence: [
                {
                  kind: 'KNOWLEDGE_ITEM' as const,
                  role: 'CORROBORATION' as const,
                  refId: otherItem.id,
                },
              ],
              rawConfidence: 1,
              reasoningTrace: { rule: 'otra' },
            },
          ]),
      } as unknown as GenerativeSynthesisStrategy;

      const withIndependent = new TriggerAnalysisRunUseCase(
        db,
        new PrismaKnowledgeSignalsAdapter(db),
        new KnowledgeSignalStrategy(),
        objectives,
        independent,
      );
      await withIndependent.execute({ organizationId: org.orgId });

      const after = await prisma.insight.findFirstOrThrow({
        where: { id: before.id },
      });
      expect(after.confidence).toBeGreaterThan(before.confidence);

      const trace = after.reasoningTrace as {
        reconciliations?: { outcome: string }[];
      };
      expect(trace.reconciliations?.[0].outcome).toBe('CORROBORATED');
      expect(item.id).toBeDefined();
    });

    it('una estrategia que discrepa sobre la naturaleza del asunto BAJA la confianza', async () => {
      await createKnowledgeItem(org, { confidenceScore: 0.1 });
      await trigger.execute({ organizationId: org.orgId });
      const before = await prisma.insight.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });

      const otherItem = await createKnowledgeItem(org, {
        title: 'Discrepante',
      });
      const dissenting = {
        key: 'estrategia-discrepante',
        version: '1.0.0',
        kind: 'GENERATIVE' as const,
        baseReliability: 0.6,
        producibleTypes: [InsightType.PATTERN],
        generate: () =>
          Promise.resolve([
            {
              subjectIdentity: before.subjectIdentity,
              // Afirma que es un patrón sostenido, no una desviación puntual.
              type: InsightType.PATTERN,
              summary: 'Discrepa sobre la naturaleza del hallazgo',
              evidence: [
                {
                  kind: 'KNOWLEDGE_ITEM' as const,
                  role: 'CONTRADICTION' as const,
                  refId: otherItem.id,
                },
              ],
              rawConfidence: 1,
              reasoningTrace: { rule: 'discrepa' },
            },
          ]),
      } as unknown as GenerativeSynthesisStrategy;

      const withDissent = new TriggerAnalysisRunUseCase(
        db,
        new PrismaKnowledgeSignalsAdapter(db),
        new KnowledgeSignalStrategy(),
        objectives,
        dissenting,
      );
      await withDissent.execute({ organizationId: org.orgId });

      const after = await prisma.insight.findFirstOrThrow({
        where: { id: before.id },
      });
      expect(after.confidence).toBeLessThan(before.confidence);

      // La discrepancia nunca se ignora en silencio: queda en la traza (§9, §10).
      const trace = after.reasoningTrace as {
        reconciliations?: { outcome: string }[];
      };
      expect(trace.reconciliations?.[0].outcome).toBe('CONTRADICTED');
    });
  });

  describe('3.2 — BusinessObjective y gate de riesgo (§3.6, §8)', () => {
    it('un candidato inferido NO puede anclar un juicio de valor hasta que una persona lo confirme', async () => {
      const inferred = await objectives.declare({
        organizationId: org.orgId,
        statement: 'El churn debe estar por debajo del 5%',
        origin: BusinessObjectiveOrigin.AUTOMATIC_INFERENCE,
      });

      expect(inferred.status).toBe('INFERRED');
      expect(await objectives.listConfirmedAndCurrent(org.orgId)).toHaveLength(
        0,
      );

      await objectives.confirm({
        organizationId: org.orgId,
        businessObjectiveId: inferred.id,
        actorUserId: org.userId,
      });

      expect(await objectives.listConfirmedAndCurrent(org.orgId)).toHaveLength(
        1,
      );
    });

    it('una edición manual conserva la confirmación; una re-inferencia NO la hereda', async () => {
      const manual = await objectives.declare({
        organizationId: org.orgId,
        statement: 'Expansión a LATAM',
        origin: BusinessObjectiveOrigin.MANUAL_DECLARATION,
        actorUserId: org.userId,
      });

      const edited = await objectives.createNewVersion({
        organizationId: org.orgId,
        businessObjectiveId: manual.id,
        statement: 'Expansión a LATAM y Brasil',
        origin: BusinessObjectiveOrigin.MANUAL_DECLARATION,
        actorUserId: org.userId,
      });
      expect(edited.status).toBe('CONFIRMED');

      const reinferred = await objectives.createNewVersion({
        organizationId: org.orgId,
        businessObjectiveId: edited.id,
        statement: 'Expansión a LATAM, Brasil y México',
        origin: BusinessObjectiveOrigin.AUTOMATIC_INFERENCE,
      });
      // Ninguna confirmación humana se hereda a un contenido que esa persona nunca vio.
      expect(reinferred.status).toBe('INFERRED');

      // Y deja de poder anclar hasta reconfirmarse.
      const current = await objectives.listConfirmedAndCurrent(org.orgId);
      expect(current.map((o) => o.id)).not.toContain(reinferred.id);
    });

    it('una declaración manual sin autor identificado se rechaza', async () => {
      await expect(
        objectives.declare({
          organizationId: org.orgId,
          statement: 'x',
          origin: BusinessObjectiveOrigin.MANUAL_DECLARATION,
        }),
      ).rejects.toThrow();
    });
  });

  describe('3.4 — la obsolescencia se evalúa, nunca se propaga (§3.4)', () => {
    it('un cambio en la evidencia se lee como STALE SIN emitir ninguna señal de recálculo', async () => {
      const item = await createKnowledgeItem(org, {
        confidenceComputedAt: new Date('2026-01-01'),
      });
      const insight = await createInsight(org, {
        subjectIdentity: 'asunto-x',
        evidenceItemIds: [item.id],
        confidenceComputedAt: new Date('2026-06-01'),
      });

      expect(
        (await retriever.execute({ organizationId: org.orgId }))[0].freshness,
      ).toBe('FRESH');

      // Se cambia la evidencia sin notificar absolutamente nada al Understanding Engine.
      await prisma.knowledgeItem.update({
        where: { id: item.id },
        data: { confidenceComputedAt: new Date('2026-09-01') },
      });

      const after = await retriever.execute({ organizationId: org.orgId });
      expect(after[0].id).toBe(insight.id);
      expect(after[0].freshness).toBe('STALE');
      expect(
        await retriever.execute({
          organizationId: org.orgId,
          requireFresh: true,
        }),
      ).toHaveLength(0);
    });

    it('evidencia en estado terminal hace el Insight UNRESOLVABLE', async () => {
      const item = await createKnowledgeItem(org);
      await createInsight(org, {
        subjectIdentity: 'y',
        evidenceItemIds: [item.id],
      });

      await prisma.knowledgeItem.update({
        where: { id: item.id },
        data: { status: 'SUPERSEDED' },
      });

      expect(
        (await retriever.execute({ organizationId: org.orgId }))[0].freshness,
      ).toBe('UNRESOLVABLE');
    });

    it('la confianza decae en lectura, y la curación humana la protege', async () => {
      const insight = await createInsight(org, {
        subjectIdentity: 'z',
        confidence: 0.9,
        confidenceComputedAt: new Date('2026-01-01'),
      });

      const decayed = (
        await retriever.execute({ organizationId: org.orgId })
      )[0];
      expect(decayed.confidence).toBeLessThan(0.9);

      await curator.curate({
        organizationId: org.orgId,
        insightId: insight.id,
        type: InsightFeedbackType.CONFIRMATION,
        actorUserId: org.userId,
      });

      const curated = (
        await retriever.execute({ organizationId: org.orgId })
      )[0];
      expect(curated.confidence).toBe(0.9);
      expect(curated.curation?.type).toBe('CONFIRMATION');
    });
  });

  describe('3.5 — curación humana y puente con Recommendation (§3.7, §11)', () => {
    it('revocar una curación crea un registro nuevo sin borrar el anterior', async () => {
      const insight = await createInsight(org, { subjectIdentity: 'curado' });

      await curator.curate({
        organizationId: org.orgId,
        insightId: insight.id,
        type: InsightFeedbackType.CONFIRMATION,
        actorUserId: org.userId,
      });
      const feedback = await prisma.insightFeedback.findFirstOrThrow({
        where: { insightId: insight.id },
      });
      await curator.revokeCuration({
        organizationId: org.orgId,
        feedbackId: feedback.id,
        actorUserId: org.userId,
      });

      expect(
        await prisma.insightFeedback.count({
          where: { insightId: insight.id },
        }),
      ).toBe(2);
      expect(
        (await retriever.execute({ organizationId: org.orgId }))[0].curation,
      ).toBeNull();
    });

    it('un Insight descartado se excluye por defecto y solo reaparece en modo histórico', async () => {
      const insight = await createInsight(org, {
        subjectIdentity: 'descartado',
      });

      await curator.curate({
        organizationId: org.orgId,
        insightId: insight.id,
        type: InsightFeedbackType.DISMISSAL,
        actorUserId: org.userId,
      });

      expect(
        await retriever.execute({ organizationId: org.orgId }),
      ).toHaveLength(0);
      expect(
        await retriever.execute({
          organizationId: org.orgId,
          historicalMode: true,
        }),
      ).toHaveLength(1);
    });

    it('escalar crea una Recommendation en NEW con contrato completo, alcance propagado y sin ejecutar nada', async () => {
      const item = await createKnowledgeItem(org);
      const collection = await prisma.knowledgeCollection.create({
        data: { organizationId: org.orgId, name: 'RR. HH.' },
      });
      await prisma.knowledgeItemCollection.create({
        data: {
          organizationId: org.orgId,
          knowledgeItemId: item.id,
          knowledgeCollectionId: collection.id,
        },
      });
      const insight = await createInsight(org, {
        subjectIdentity: 'riesgo-operativo',
        type: InsightType.RISK,
        evidenceItemIds: [item.id],
      });

      const recommendation = await curator.escalateToRecommendation({
        organizationId: org.orgId,
        insightId: insight.id,
        contract: {
          title: 'Revisar el proceso',
          detected: 'Incidencias recurrentes',
          justification: 'Afecta a un objetivo declarado',
          estimatedImpact: 'Alto',
          advantages: 'Menos reincidencia',
          drawbacks: 'Requiere formación',
          affectedAreas: 'Operaciones',
          migrationPlan: 'No aplica (sin impacto estructural)',
        },
      });

      expect(recommendation.status).toBe('NEW');
      expect(recommendation.sourceInsightId).toBe(insight.id);
      // Sin alcance propagado, escalar sería una vía de blanqueo (§12).
      expect(recommendation.effectiveCollectionScope).toContain(collection.id);
      expect(recommendation.migrationPlan).toBeTruthy();
    });

    it('el plan de migración NUNCA se omite', async () => {
      const insight = await createInsight(org, { subjectIdentity: 'sin-plan' });

      await expect(
        curator.escalateToRecommendation({
          organizationId: org.orgId,
          insightId: insight.id,
          contract: {
            title: 't',
            detected: 'd',
            justification: 'j',
            estimatedImpact: 'i',
            advantages: 'a',
            drawbacks: 'dr',
            affectedAreas: 'ar',
            migrationPlan: '   ',
          },
        }),
      ).rejects.toThrow(/plan de migración/i);
    });

    it('un contrato incompleto es 400, no 500: la peticion esta mal, no el servidor', async () => {
      const insight = await createInsight(org, {
        subjectIdentity: 'sin-plan-400',
      });

      // Devolver 500 presentaria como averia nuestra algo que quien llama puede corregir.
      await expect(
        curator.escalateToRecommendation({
          organizationId: org.orgId,
          insightId: insight.id,
          contract: {
            title: 't',
            detected: 'd',
            justification: 'j',
            estimatedImpact: 'i',
            advantages: 'a',
            drawbacks: 'dr',
            affectedAreas: 'ar',
            migrationPlan: '',
          },
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('registrar una REVOCATION por la via equivocada es 400', async () => {
      const insight = await createInsight(org, {
        subjectIdentity: 'revoca-mal',
      });

      await expect(
        curator.curate({
          organizationId: org.orgId,
          insightId: insight.id,
          actorUserId: org.userId,
          type: InsightFeedbackType.REVOCATION,
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('un Insight no activo no puede escalarse', async () => {
      const insight = await createInsight(org, {
        subjectIdentity: 'expirado',
        status: InsightStatus.EXPIRED,
      });

      await expect(
        curator.escalateToRecommendation({
          organizationId: org.orgId,
          insightId: insight.id,
          contract: {
            title: 't',
            detected: 'd',
            justification: 'j',
            estimatedImpact: 'i',
            advantages: 'a',
            drawbacks: 'dr',
            affectedAreas: 'ar',
            migrationPlan: 'no aplica',
          },
        }),
      ).rejects.toThrow();
    });

    it('escalar un Insight no activo es 409: conflicto de estado, no fallo del servidor', async () => {
      const insight = await createInsight(org, {
        subjectIdentity: 'expirado-409',
        status: InsightStatus.EXPIRED,
      });

      // La MISMA llamada seria valida si el Insight siguiera activo: eso es 409, no 500.
      await expect(
        curator.escalateToRecommendation({
          organizationId: org.orgId,
          insightId: insight.id,
          contract: {
            title: 't',
            detected: 'd',
            justification: 'j',
            estimatedImpact: 'i',
            advantages: 'a',
            drawbacks: 'dr',
            affectedAreas: 'ar',
            migrationPlan: 'no aplica',
          },
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('3.6 — RetrieveInsights: aislamiento y alcance (§12)', () => {
    it('ninguna organización ve Insight de otra', async () => {
      const other = await createTestOrg('ue-int-b');
      await createInsight(org, { subjectIdentity: 'de-a' });
      await createInsight(other, { subjectIdentity: 'secreto-de-b' });

      const fromA = await retriever.execute({ organizationId: org.orgId });
      const fromB = await retriever.execute({ organizationId: other.orgId });

      expect(fromA).toHaveLength(1);
      expect(fromA[0].summary).toContain('de-a');
      expect(fromB).toHaveLength(1);
      expect(fromB[0].summary).toContain('secreto-de-b');

      await destroyTestOrg(other);
    });

    it('la cobertura de colección debe ser COMPLETA: el acceso parcial deniega', async () => {
      const itemA = await createKnowledgeItem(org, { title: 'De RR. HH.' });
      const itemB = await createKnowledgeItem(org, { title: 'De Legal' });
      const hr = await prisma.knowledgeCollection.create({
        data: { organizationId: org.orgId, name: 'RR. HH.' },
      });
      const legal = await prisma.knowledgeCollection.create({
        data: { organizationId: org.orgId, name: 'Legal' },
      });
      await prisma.knowledgeItemCollection.createMany({
        data: [
          {
            organizationId: org.orgId,
            knowledgeItemId: itemA.id,
            knowledgeCollectionId: hr.id,
          },
          {
            organizationId: org.orgId,
            knowledgeItemId: itemB.id,
            knowledgeCollectionId: legal.id,
          },
        ],
      });

      // Un Insight que correlaciona evidencia de AMBAS colecciones.
      await createInsight(org, {
        subjectIdentity: 'correlacion-transversal',
        evidenceItemIds: [itemA.id, itemB.id],
      });

      // Con acceso solo a una de las dos: se deniega, no se concede parcialmente.
      expect(
        await retriever.execute({
          organizationId: org.orgId,
          allowedCollectionIds: [hr.id],
        }),
      ).toHaveLength(0);

      expect(
        await retriever.execute({
          organizationId: org.orgId,
          allowedCollectionIds: [hr.id, legal.id],
        }),
      ).toHaveLength(1);
    });

    it('evidencia sin colección es inaccesible por defecto (fail-closed)', async () => {
      const item = await createKnowledgeItem(org);
      await createInsight(org, {
        subjectIdentity: 'sin-coleccion',
        evidenceItemIds: [item.id],
      });

      expect(
        await retriever.execute({
          organizationId: org.orgId,
          allowedCollectionIds: ['cualquiera'],
        }),
      ).toHaveLength(0);
    });
  });
});

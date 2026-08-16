import {
  InsightFeedbackType,
  InsightStatus,
  InsightType,
  MembershipRole,
} from '@businessbrain/database';
import { NotFoundException } from '@nestjs/common';
import { BeliefHistoryService } from '../../src/understanding-engine/application/belief-history.service';
import { BusinessObjectiveService } from '../../src/understanding-engine/application/business-objective.service';
import { CurateInsightUseCase } from '../../src/understanding-engine/application/curate-insight.use-case';
import { RetrieveInsightsUseCase } from '../../src/understanding-engine/application/retrieve-insights.use-case';
import {
  ORGANIZATION_WIDE_REASONS,
  organizationWideScope,
} from '../../src/knowledge-engine/domain/knowledge-scope';
import { TriggerAnalysisRunUseCase } from '../../src/understanding-engine/application/trigger-analysis-run.use-case';
import { PrismaKnowledgeSignalsAdapter } from '../../src/understanding-engine/infrastructure/prisma-knowledge-signals.adapter';
import { KnowledgeSignalStrategy } from '../../src/understanding-engine/infrastructure/strategies/knowledge-signal.strategy';
import type { GenerativeSynthesisStrategy } from '../../src/understanding-engine/infrastructure/strategies/generative-synthesis.strategy';
import { CollectionAccessService } from '../../src/knowledge-engine/application/collection-access.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  auditService,
  createInsight,
  createKnowledgeItem,
  createMember,
  createTestOrg,
  destroyTestOrg,
  insightScope,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * Memoria de la creencia contra Postgres real — Fase 7.
 *
 * Lo que se verifica aquí no puede demostrarlo un doble: que el índice único parcial permite
 * versionar sin bloquear, que la evidencia histórica es inmutable de verdad, y que el
 * alcance se aplica versión a versión sin filtrar identificadores por la puerta de atrás.
 */
describe('Memoria de la creencia (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let history: BeliefHistoryService;
  let access: CollectionAccessService;

  beforeAll(() => {
    access = new CollectionAccessService(db, auditService(db));
    history = new BeliefHistoryService(db, insightScope(db), access);
  });

  /**
   * Colección base concedida al propietario.
   *
   * Toda evidencia nace dentro de una colección porque el sistema falla cerrado: la evidencia
   * sin colección tiene alcance vacío y NADIE la ve (regla de alcance vacío). Sembrar sin
   * colección haría que estos tests pasaran por el motivo equivocado.
   */
  let baseCollectionId: string;

  beforeEach(async () => {
    org = await createTestOrg('belief-hist');
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: org.orgId, name: 'General' },
    });
    baseCollectionId = collection.id;
    await access.grant({
      organizationId: org.orgId,
      knowledgeCollectionId: baseCollectionId,
      userId: org.userId,
      grantedById: org.userId,
    });
  });

  /** Documento dentro de la colección base. */
  async function doc(title: string) {
    const item = await createKnowledgeItem(org, { title });
    await prisma.knowledgeItemCollection.create({
      data: {
        knowledgeItemId: item.id,
        knowledgeCollectionId: baseCollectionId,
        organizationId: org.orgId,
      },
    });
    return item;
  }

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Cadena de tres versiones sobre el mismo asunto, cada una con su propia evidencia. */
  async function seedChain() {
    const subject = `asunto:${Math.random().toString(36).slice(2)}`;
    const docA = await doc('Informe A');
    const docB = await doc('Informe B');
    const docC = await doc('Informe C');

    const v1 = await createInsight(org, {
      subjectIdentity: subject,
      status: InsightStatus.SUPERSEDED,
      confidence: 0.5,
      evidenceItemIds: [docA.id],
    });
    const v2 = await createInsight(org, {
      subjectIdentity: subject,
      status: InsightStatus.SUPERSEDED,
      confidence: 0.7,
      supersedesInsightId: v1.id,
      evidenceItemIds: [docA.id, docB.id],
    });
    const v3 = await createInsight(org, {
      subjectIdentity: subject,
      status: InsightStatus.ACTIVE,
      confidence: 0.9,
      supersedesInsightId: v2.id,
      evidenceItemIds: [docA.id, docB.id, docC.id],
    });

    return { subject, docA, docB, docC, v1, v2, v3 };
  }

  const read = (insightId: string, userId = org.userId) =>
    history.forInsight({
      organizationId: org.orgId,
      actorUserId: userId,
      insightId,
    });

  describe('la historia es fiel a lo que se creyó', () => {
    it('devuelve la trayectoria completa con la evidencia exacta de cada cambio', async () => {
      const { docB, docC, v1, v2, v3 } = await seedChain();

      const result = await read(v3.id);

      expect(result.versions.map((v) => v.id)).toEqual([v1.id, v2.id, v3.id]);
      expect(result.versions.map((v) => v.confidence)).toEqual([0.5, 0.7, 0.9]);
      expect(result.transitions).toHaveLength(2);
      // Atribución exacta: qué documento provocó cada movimiento de la confianza.
      expect(result.transitions[0].changes).toEqual([
        { kind: 'ENTERED', ref: { kind: 'KNOWLEDGE_ITEM', refId: docB.id } },
      ]);
      expect(result.transitions[1].changes).toEqual([
        { kind: 'ENTERED', ref: { kind: 'KNOWLEDGE_ITEM', refId: docC.id } },
      ]);
      expect(result.transitions[1].confidenceDelta).toBeCloseTo(0.2, 4);
    });

    it('se puede preguntar por CUALQUIER versión y se obtiene la misma historia', async () => {
      const { v1, v3 } = await seedChain();

      const desdeLaPrimera = await read(v1.id);
      const desdeLaUltima = await read(v3.id);

      expect(desdeLaPrimera.versions.map((v) => v.id)).toEqual(
        desdeLaUltima.versions.map((v) => v.id),
      );
    });

    it('una creencia que nunca cambió tiene una versión y ninguna transición', async () => {
      const base = await doc('Único informe');
      const insight = await createInsight(org, {
        subjectIdentity: 'asunto-estable',
        evidenceItemIds: [base.id],
      });

      const result = await read(insight.id);

      expect(result.versions).toHaveLength(1);
      expect(result.transitions).toEqual([]);
      expect(result.hiddenVersionCount).toBe(0);
    });

    it('el orden lo da la cadena, no el reloj', async () => {
      const subject = 'asunto-con-reloj-desfasado';
      const base = await doc('Informe base');
      const v1 = await createInsight(org, {
        subjectIdentity: subject,
        status: InsightStatus.SUPERSEDED,
        evidenceItemIds: [base.id],
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      });
      // La sucesora dice haber nacido antes: desfase entre procesos.
      const v2 = await createInsight(org, {
        subjectIdentity: subject,
        supersedesInsightId: v1.id,
        evidenceItemIds: [base.id],
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const result = await read(v2.id);

      expect(result.versions.map((v) => v.id)).toEqual([v1.id, v2.id]);
    });

    it('atribuye una CONTRADICCIÓN aunque la evidencia siguiera presente', async () => {
      const subject = 'asunto-contradicho';
      const fuente = await doc('Fuente discutida');
      const v1 = await createInsight(org, {
        subjectIdentity: subject,
        status: InsightStatus.SUPERSEDED,
        confidence: 0.9,
        evidenceItemIds: [fuente.id],
      });
      const v2 = await createInsight(org, {
        subjectIdentity: subject,
        confidence: 0.6,
        supersedesInsightId: v1.id,
        evidenceItemIds: [fuente.id],
        evidenceRole: 'CONTRADICTION',
      });

      const result = await read(v2.id);

      expect(result.transitions[0].changes).toEqual([
        {
          kind: 'CONTRADICTED',
          ref: { kind: 'KNOWLEDGE_ITEM', refId: fuente.id },
        },
      ]);
      expect(result.transitions[0].confidenceDelta).toBeLessThan(0);
    });

    it('señala evidencia cuya FUENTE fue versionada desde entonces', async () => {
      const subject = 'asunto-con-fuente-vieja';
      const politica = await doc('Política v1');
      const v1 = await createInsight(org, {
        subjectIdentity: subject,
        status: InsightStatus.SUPERSEDED,
        evidenceItemIds: [politica.id],
      });
      const v2 = await createInsight(org, {
        subjectIdentity: subject,
        supersedesInsightId: v1.id,
        evidenceItemIds: [politica.id],
      });
      // El documento se reemplazó por una versión nueva DESPUÉS de razonar sobre él.
      await prisma.knowledgeItem.update({
        where: { id: politica.id },
        data: { status: 'SUPERSEDED' },
      });

      const result = await read(v2.id);

      expect(result.transitions[0].changes).toEqual([
        {
          kind: 'SUPERSEDED_EVIDENCE',
          ref: { kind: 'KNOWLEDGE_ITEM', refId: politica.id },
        },
      ]);
    });

    it('la evidencia histórica es INMUTABLE: versionar la fuente no reescribe el pasado', async () => {
      const { docA, v1 } = await seedChain();
      const closureAntes = (
        await prisma.insight.findFirstOrThrow({ where: { id: v1.id } })
      ).transitiveEvidenceClosure;

      await prisma.knowledgeItem.update({
        where: { id: docA.id },
        data: { status: 'SUPERSEDED', title: 'Informe A (rectificado)' },
      });

      const despues = await prisma.insight.findFirstOrThrow({
        where: { id: v1.id },
      });
      // Lo que se creyó y sobre qué se creyó no cambia porque el mundo cambie después.
      expect(despues.transitiveEvidenceClosure).toEqual(closureAntes);
      expect(despues.confidence).toBe(0.5);
    });

    it('pagina la historia sin romper el orden', async () => {
      const { v1, v2, v3 } = await seedChain();

      const primera = await history.forInsight({
        organizationId: org.orgId,
        actorUserId: org.userId,
        insightId: v3.id,
        limit: 2,
      });
      const segunda = await history.forInsight({
        organizationId: org.orgId,
        actorUserId: org.userId,
        insightId: v3.id,
        limit: 2,
        offset: 2,
      });

      expect(primera.versions.map((v) => v.id)).toEqual([v1.id, v2.id]);
      // La página no incluye a su predecesora y aun así es una historia válida.
      expect(segunda.versions.map((v) => v.id)).toEqual([v3.id]);
    });
  });

  describe('el alcance se aplica VERSIÓN A VERSIÓN', () => {
    /** Un lector con acceso solo a la colección indicada. */
    async function readerWithAccessTo(collectionIds: string[]) {
      const userId = await createMember(org, MembershipRole.MEMBER);
      for (const knowledgeCollectionId of collectionIds) {
        await access.grant({
          organizationId: org.orgId,
          knowledgeCollectionId,
          userId,
          grantedById: org.userId,
        });
      }
      return userId;
    }

    async function collectionWith(name: string, itemIds: string[]) {
      const collection = await prisma.knowledgeCollection.create({
        data: { organizationId: org.orgId, name },
      });
      for (const knowledgeItemId of itemIds) {
        await prisma.knowledgeItemCollection.create({
          data: {
            knowledgeItemId,
            knowledgeCollectionId: collection.id,
            organizationId: org.orgId,
          },
        });
      }
      return collection;
    }

    it('una versión cuya evidencia el lector no cubre DESAPARECE y se cuenta', async () => {
      const subject = 'asunto-mixto';
      const publico = await createKnowledgeItem(org, { title: 'Público' });
      const reservado = await createKnowledgeItem(org, { title: 'Reservado' });
      const ventas = await collectionWith('Ventas', [publico.id]);
      await collectionWith('RR. HH.', [reservado.id]);

      const v1 = await createInsight(org, {
        subjectIdentity: subject,
        status: InsightStatus.SUPERSEDED,
        confidence: 0.5,
        evidenceItemIds: [publico.id],
      });
      const v2 = await createInsight(org, {
        subjectIdentity: subject,
        status: InsightStatus.SUPERSEDED,
        confidence: 0.6,
        supersedesInsightId: v1.id,
        evidenceItemIds: [publico.id, reservado.id],
      });
      const v3 = await createInsight(org, {
        subjectIdentity: subject,
        confidence: 0.8,
        supersedesInsightId: v2.id,
        evidenceItemIds: [publico.id],
      });

      const lector = await readerWithAccessTo([ventas.id]);
      const result = await read(v3.id, lector);

      expect(result.versions.map((v) => v.id)).toEqual([v1.id, v3.id]);
      expect(result.hiddenVersionCount).toBe(1);
      // Y la versión oculta no parte la historia: sigue habiendo una transición.
      expect(result.transitions).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(reservado.id);
    });

    it('no filtra por el diff evidencia que el lector no puede ver', async () => {
      const subject = 'asunto-con-fuga-potencial';
      const publico = await createKnowledgeItem(org, { title: 'Público' });
      const secreto = await createKnowledgeItem(org, { title: 'Secreto' });
      const ventas = await collectionWith('Ventas', [publico.id, secreto.id]);
      // El secreto está ADEMÁS en una colección que el lector no tiene: regla ALL.
      await collectionWith('Dirección', [secreto.id]);

      const v1 = await createInsight(org, {
        subjectIdentity: subject,
        status: InsightStatus.SUPERSEDED,
        confidence: 0.5,
        evidenceItemIds: [publico.id],
      });
      const v2 = await createInsight(org, {
        subjectIdentity: subject,
        confidence: 0.9,
        supersedesInsightId: v1.id,
        evidenceItemIds: [publico.id, secreto.id],
      });

      // La segunda versión queda fuera de su alcance; se le concede Ventas para que la
      // primera sí sea visible y se vea que el corte es por versión, no por cadena.
      const lector = await readerWithAccessTo([ventas.id]);
      const result = await read(v2.id, lector);

      expect(result.versions.map((v) => v.id)).toEqual([v1.id]);
      expect(result.hiddenVersionCount).toBe(1);
      expect(JSON.stringify(result)).not.toContain(secreto.id);
    });

    it('un lector sin ninguna concesión no ve nada, pero sabe que hay historia', async () => {
      const item = await createKnowledgeItem(org, { title: 'Acotado' });
      await collectionWith('Cerrada', [item.id]);
      const insight = await createInsight(org, {
        subjectIdentity: 'asunto-cerrado',
        evidenceItemIds: [item.id],
      });

      const lector = await createMember(org, MembershipRole.MEMBER);
      const result = await read(insight.id, lector);

      expect(result.versions).toEqual([]);
      expect(result.hiddenVersionCount).toBe(1);
      expect(JSON.stringify(result)).not.toContain(item.id);
    });

    it('otra organización no puede leer la historia ni distinguirla de inexistente', async () => {
      const { v3 } = await seedChain();
      const otra = await createTestOrg('belief-hist-otra');

      await expect(
        history.forInsight({
          organizationId: otra.orgId,
          actorUserId: otra.userId,
          insightId: v3.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      await destroyTestOrg(otra);
    });
  });

  describe('la decisión humana sobrevive al versionado (§3.7, 7.1)', () => {
    const retriever = () => new RetrieveInsightsUseCase(db);
    const curator = () =>
      new CurateInsightUseCase(db, insightScope(db), auditService(db));

    /** Lectura por el ÚNICO punto de lectura del sistema, no por consulta directa. */
    const leer = async (insightId: string) =>
      (
        await retriever().execute({
          organizationId: org.orgId,
          scope: organizationWideScope(
            ORGANIZATION_WIDE_REASONS.ANALYSIS_REASONING,
          ),
          insightIds: [insightId],
          historicalMode: true,
        })
      )[0];

    const confirmar = (insightId: string, comment?: string) =>
      curator().curate({
        organizationId: org.orgId,
        insightId,
        actorUserId: org.userId,
        type: InsightFeedbackType.CONFIRMATION,
        comment,
      });

    it('CRÍTICO: una creencia curada conserva la curación al nacer su sucesora', async () => {
      const base = await doc('Informe');
      const v1 = await createInsight(org, {
        subjectIdentity: 'asunto-curado',
        evidenceItemIds: [base.id],
      });
      await confirmar(v1.id, 'Correcto, lo hemos revisado');

      await prisma.insight.update({
        where: { id: v1.id },
        data: { status: InsightStatus.SUPERSEDED },
      });
      const v2 = await createInsight(org, {
        subjectIdentity: 'asunto-curado',
        supersedesInsightId: v1.id,
        evidenceItemIds: [base.id],
      });

      const leido = await leer(v2.id);

      // Antes de 7.1 esto era `null`: versionar descartaba en silencio el juicio humano.
      expect(leido.curation).toMatchObject({
        type: 'CONFIRMATION',
        comment: 'Correcto, lo hemos revisado',
        origin: 'INHERITED',
        curatedVersionId: v1.id,
        disputed: false,
      });
    });

    it('la curación heredada BLOQUEA el decaimiento automático', async () => {
      const base = await doc('Informe viejo');
      // Calculada hace mucho: sin curación el decaimiento la habría bajado.
      const antiguo = new Date('2026-01-01T00:00:00.000Z');
      const v1 = await createInsight(org, {
        subjectIdentity: 'asunto-que-decae',
        confidence: 0.9,
        confidenceComputedAt: antiguo,
        evidenceItemIds: [base.id],
      });
      await confirmar(v1.id);
      await prisma.insight.update({
        where: { id: v1.id },
        data: { status: InsightStatus.SUPERSEDED },
      });
      const v2 = await createInsight(org, {
        subjectIdentity: 'asunto-que-decae',
        supersedesInsightId: v1.id,
        confidence: 0.9,
        confidenceComputedAt: antiguo,
        evidenceItemIds: [base.id],
      });

      const leido = await leer(v2.id);

      expect(leido.curation?.origin).toBe('INHERITED');
      // §3.7: prioridad sobre cualquier recálculo automático, también heredada.
      expect(leido.confidence).toBe(0.9);
    });

    it('una curación PROPIA de la sucesora gana sobre la heredable', async () => {
      const base = await doc('Informe');
      const v1 = await createInsight(org, {
        subjectIdentity: 'asunto-recurado',
        evidenceItemIds: [base.id],
      });
      await confirmar(v1.id, 'sobre la primera');
      await prisma.insight.update({
        where: { id: v1.id },
        data: { status: InsightStatus.SUPERSEDED },
      });
      const v2 = await createInsight(org, {
        subjectIdentity: 'asunto-recurado',
        supersedesInsightId: v1.id,
        evidenceItemIds: [base.id],
      });
      await confirmar(v2.id, 'sobre la segunda');

      expect(await leer(v2.id).then((i) => i.curation)).toMatchObject({
        comment: 'sobre la segunda',
        origin: 'OWN',
        curatedVersionId: v2.id,
      });
    });

    it('una reconciliación real por CONTRADICCIÓN deja la curación EN DISPUTA', async () => {
      // Cadena producida por el motor de verdad, no sembrada: la traza de reconciliación la
      // escribe `TriggerAnalysisRun`, y de ahí sale la marca de disputa.
      const item = await createKnowledgeItem(org, { confidenceScore: 0.05 });
      await prisma.knowledgeItemCollection.create({
        data: {
          knowledgeItemId: item.id,
          knowledgeCollectionId: baseCollectionId,
          organizationId: org.orgId,
        },
      });

      const sinGenerativa = {
        key: 'sin-generativa',
        version: '1.0.0',
        kind: 'GENERATIVE' as const,
        baseReliability: 0.6,
        producibleTypes: [],
        generate: () => Promise.resolve([]),
      } as unknown as GenerativeSynthesisStrategy;

      const analizar = (generativa: GenerativeSynthesisStrategy) =>
        new TriggerAnalysisRunUseCase(
          db,
          new PrismaKnowledgeSignalsAdapter(db),
          new KnowledgeSignalStrategy(),
          new BusinessObjectiveService(db, auditService(db)),
          generativa,
          auditService(db),
        ).execute({ organizationId: org.orgId });

      await analizar(sinGenerativa);

      const v1 = await prisma.insight.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });
      await confirmar(v1.id);

      // Otra estrategia discrepa sobre la NATURALEZA del asunto: contradicción (§9).
      const otro = await doc('Fuente discrepante');
      const discrepante = {
        key: 'estrategia-discrepante',
        version: '1.0.0',
        kind: 'SYMBOLIC' as const,
        baseReliability: 0.9,
        producibleTypes: [InsightType.PATTERN],
        generate: () =>
          Promise.resolve([
            {
              subjectIdentity: v1.subjectIdentity,
              type: InsightType.PATTERN,
              summary: 'Discrepa sobre la naturaleza del hallazgo',
              evidence: [
                {
                  kind: 'KNOWLEDGE_ITEM' as const,
                  role: 'CONTRADICTION' as const,
                  refId: otro.id,
                },
              ],
              rawConfidence: 1,
              reasoningTrace: { rule: 'discrepa' },
            },
          ]),
      } as unknown as GenerativeSynthesisStrategy;

      await analizar(discrepante);

      const sucesora = await prisma.insight.findFirstOrThrow({
        where: { supersedesInsightId: v1.id },
      });

      expect(await leer(sucesora.id).then((i) => i.curation)).toMatchObject({
        origin: 'INHERITED',
        curatedVersionId: v1.id,
        // La evidencia nueva contradice lo que la persona confirmó: se dice.
        disputed: true,
      });
    });

    it('la curación NO se hereda a través de un DISCARDED', async () => {
      const base = await doc('Informe');
      const v1 = await createInsight(org, {
        subjectIdentity: 'asunto-descartado',
        evidenceItemIds: [base.id],
      });
      await confirmar(v1.id);
      // El asunto se descarta después: deja de sostenerse.
      await prisma.insight.update({
        where: { id: v1.id },
        data: { status: InsightStatus.DISCARDED },
      });
      const v2 = await createInsight(org, {
        subjectIdentity: 'asunto-descartado',
        supersedesInsightId: v1.id,
        evidenceItemIds: [base.id],
      });

      expect(await leer(v2.id).then((i) => i.curation)).toBeNull();
    });

    it('escalar exige curación PROPIA: la heredada NO autoriza', async () => {
      const base = await doc('Informe');
      const v1 = await createInsight(org, {
        subjectIdentity: 'asunto-escalable',
        type: InsightType.PATTERN,
        evidenceItemIds: [base.id],
      });
      await confirmar(v1.id);
      await prisma.insight.update({
        where: { id: v1.id },
        data: { status: InsightStatus.SUPERSEDED },
      });
      const v2 = await createInsight(org, {
        subjectIdentity: 'asunto-escalable',
        type: InsightType.PATTERN,
        supersedesInsightId: v1.id,
        evidenceItemIds: [base.id],
      });

      const contrato = {
        title: 'Actuar',
        detected: 'Algo',
        justification: 'Porque afecta a un objetivo',
        estimatedImpact: 'Alto',
        advantages: 'Varias',
        drawbacks: 'Algunas',
        affectedAreas: 'Operaciones',
        migrationPlan: 'No aplica (sin impacto estructural)',
      };

      // La curación heredada se lee y tiene prioridad sobre el decaimiento, pero no vale
      // como aprobación de una propuesta de acción sobre una afirmación distinta (§11).
      await expect(
        curator().escalateToRecommendation({
          organizationId: org.orgId,
          actorUserId: org.userId,
          insightId: v2.id,
          contract: contrato,
        }),
      ).rejects.toThrow(/curación humana explícita sobre esta versión/i);

      // Confirmar ESTA versión sí autoriza.
      await confirmar(v2.id);
      const recomendacion = await curator().escalateToRecommendation({
        organizationId: org.orgId,
        actorUserId: org.userId,
        insightId: v2.id,
        contract: contrato,
      });
      expect(recomendacion.sourceInsightId).toBe(v2.id);
    });
  });

  describe('la cadena no puede bifurcarse ni ciclarse', () => {
    it('el índice único impide dos versiones ACTIVE del mismo asunto', async () => {
      await createInsight(org, { subjectIdentity: 'asunto-unico' });

      await expect(
        createInsight(org, { subjectIdentity: 'asunto-unico' }),
      ).rejects.toThrow(/[Uu]nique/);
    });

    it('el índice EXCLUYE los estados terminales: la versión superada no estorba', async () => {
      const subject = 'asunto-versionado';
      const v1 = await createInsight(org, {
        subjectIdentity: subject,
        status: InsightStatus.SUPERSEDED,
      });

      // Nace la sucesora ACTIVE sin conflicto con la superada: exactamente lo que §370 pide.
      const v2 = await createInsight(org, {
        subjectIdentity: subject,
        supersedesInsightId: v1.id,
      });

      expect(v2.status).toBe(InsightStatus.ACTIVE);
      expect(
        await prisma.insight.count({
          where: { organizationId: org.orgId, subjectIdentity: subject },
        }),
      ).toBe(2);
    });

    it('DISCARDED tampoco bloquea una versión nueva del mismo asunto', async () => {
      const subject = 'asunto-descartado';
      await createInsight(org, {
        subjectIdentity: subject,
        status: InsightStatus.DISCARDED,
      });

      const nueva = await createInsight(org, { subjectIdentity: subject });

      expect(nueva.status).toBe(InsightStatus.ACTIVE);
    });

    it('DOS reconciliaciones simultáneas producen UNA sola sucesora y ninguna falla', async () => {
      // El criterio de §12: la corrección bajo concurrencia la dan la unicidad y la
      // reconciliación, NO un cerrojo. Nada aquí serializa el dominio.
      const subject = 'asunto-en-disputa';
      const base = await doc('Base');
      const v1 = await createInsight(org, {
        subjectIdentity: subject,
        confidence: 0.5,
        evidenceItemIds: [base.id],
      });

      const otra = await doc('Evidencia independiente');
      const independiente = {
        key: 'estrategia-concurrente',
        version: '1.0.0',
        kind: 'SYMBOLIC' as const,
        baseReliability: 0.9,
        producibleTypes: [InsightType.ANOMALY],
        generate: () =>
          Promise.resolve([
            {
              subjectIdentity: subject,
              type: InsightType.ANOMALY,
              summary: 'Mismo asunto, otra vía',
              evidence: [
                {
                  kind: 'KNOWLEDGE_ITEM' as const,
                  role: 'CORROBORATION' as const,
                  refId: otra.id,
                },
              ],
              rawConfidence: 1,
              reasoningTrace: { rule: 'concurrente' },
            },
          ]),
      } as unknown as GenerativeSynthesisStrategy;

      const trigger = new TriggerAnalysisRunUseCase(
        db,
        new PrismaKnowledgeSignalsAdapter(db),
        new KnowledgeSignalStrategy(),
        new BusinessObjectiveService(db, auditService(db)),
        independiente,
        auditService(db),
      );

      const runs = await Promise.all([
        trigger.execute({ organizationId: org.orgId }),
        trigger.execute({ organizationId: org.orgId }),
      ]);

      // Ninguna ejecución falla: perder la carrera no es un error.
      expect(runs.every((r) => r.status === 'SUCCESS')).toBe(true);

      const successors = await prisma.insight.findMany({
        where: { organizationId: org.orgId, supersedesInsightId: v1.id },
      });
      expect(successors).toHaveLength(1);

      // Y la cadena sigue siendo lineal: una sola versión no terminal del asunto.
      const noTerminales = await prisma.insight.count({
        where: {
          organizationId: org.orgId,
          subjectIdentity: subject,
          status: InsightStatus.ACTIVE,
        },
      });
      expect(noTerminales).toBe(1);

      const historia = await read(successors[0].id);
      expect(historia.versions.map((v) => v.id)).toEqual([
        v1.id,
        successors[0].id,
      ]);
    });

    it('el índice único sobre supersedesInsightId impide la bifurcación', async () => {
      const subject = 'asunto-bifurcable';
      const v1 = await createInsight(org, {
        subjectIdentity: subject,
        status: InsightStatus.SUPERSEDED,
      });
      await createInsight(org, {
        subjectIdentity: subject,
        supersedesInsightId: v1.id,
      });

      // Un segundo sucesor de la MISMA versión no puede existir: no hay dos futuros.
      await expect(
        createInsight(org, {
          subjectIdentity: `${subject}-otro`,
          supersedesInsightId: v1.id,
        }),
      ).rejects.toThrow(/[Uu]nique/);
    });
  });
});

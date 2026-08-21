import { RecommendationsService } from '../../src/recommendations/application/recommendations.service';
import { CollectionAccessService } from '../../src/knowledge-engine/application/collection-access.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  FULL_PROPOSAL,
  auditService,
  createInsight,
  createKnowledgeItem,
  createMember,
  createTestOrg,
  destroyTestOrg,
  prisma,
  proposeFromInsights,
  type TestOrg,
} from './fixtures';

/**
 * De conclusión a PROPUESTA, contra Postgres real.
 *
 * Lo que se verifica aquí no es que el modelo escriba bien —eso es del modelo— sino las
 * garantías que son NUESTRAS: cuándo se propone y cuándo no, que el alcance heredado es el de
 * la evidencia, que no se duplica, que una conclusión obsoleta no arrastra propuestas, y que
 * decidir queda registrado sin ejecutar nada.
 *
 * La propuesta nace del flujo real: se crea la conclusión con su evidencia y se deja que el
 * caso de uso decida. No se siembra ninguna `Recommendation`.
 */
describe('Recomendaciones automáticas (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let access: CollectionAccessService;
  let recommendations: RecommendationsService;

  beforeEach(async () => {
    org = await createTestOrg('recomendaciones');
    access = new CollectionAccessService(db, auditService(db));
    recommendations = new RecommendationsService(db, access, auditService(db));
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Conocimiento en una colección concedida, y una conclusión sólida que se apoya en él.
   *
   * Dos piezas de evidencia porque la regla exige más de una: un dato aislado puede ser un
   * error de un documento.
   */
  const seedInsight = async (
    overrides: Parameters<typeof createInsight>[1] extends infer T
      ? Partial<T & Record<string, unknown>>
      : never = {},
  ) => {
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: org.orgId, name: 'Comercial' },
    });
    await access.grant({
      organizationId: org.orgId,
      knowledgeCollectionId: collection.id,
      userId: org.userId,
      grantedById: org.userId,
    });

    const items = await Promise.all([
      createKnowledgeItem(org, { title: 'Política de descuentos' }),
      createKnowledgeItem(org, { title: 'Informe de márgenes' }),
    ]);
    for (const item of items) {
      await prisma.knowledgeItemCollection.create({
        data: {
          organizationId: org.orgId,
          knowledgeItemId: item.id,
          knowledgeCollectionId: collection.id,
        },
      });
    }

    const insight = await createInsight(org, {
      subjectIdentity: 'margen-canal-mayorista',
      type: 'RISK',
      confidence: 0.85,
      evidenceItemIds: items.map((item) => item.id),
      ...overrides,
    });

    return { insight, collection, items };
  };

  const propose = (answer?: string) =>
    proposeFromInsights(db, answer).execute({
      organizationId: org.orgId,
      analysisRunId: org.analysisRunId,
    });

  describe('cuándo SÍ se propone', () => {
    it('CRITERIO DE CIERRE: una conclusión sólida produce una propuesta pendiente', async () => {
      const { insight, collection } = await seedInsight();

      expect(await propose()).toBe(1);

      const propuesta = await prisma.recommendation.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });

      // Nace PENDIENTE: registrada para que una persona la lea, sin ejecutar nada.
      expect(propuesta.status).toBe('NEW');
      expect(propuesta.resolvedById).toBeNull();
      expect(propuesta.resolvedAt).toBeNull();

      // Propuesta por BusinessBrain, no redactada por una persona.
      expect(propuesta.createdById).toBeNull();

      // Con los ocho apartados del contrato, no un texto suelto.
      expect(propuesta.title).toBe(FULL_PROPOSAL.title);
      for (const campo of [
        'detected',
        'justification',
        'estimatedImpact',
        'advantages',
        'drawbacks',
        'affectedAreas',
        'migrationPlan',
      ] as const) {
        expect(propuesta[campo]).toBeTruthy();
      }

      // Trazable hasta la conclusión, y con el alcance heredado de SU evidencia.
      expect(propuesta.sourceInsightId).toBe(insight.id);
      expect(propuesta.effectiveCollectionScope).toEqual([collection.id]);
    });

    it('queda traza de que el sistema propuso, y de que no ejecutó nada', async () => {
      await seedInsight();
      await propose();

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { organizationId: org.orgId, action: 'recommendation.proposed' },
      });

      // Sin actor: no lo provocó una persona.
      expect(log.actorId).toBeNull();
      expect(log.metadata).toMatchObject({ externalActionExecuted: false });
    });
  });

  describe('CRÍTICO: cuándo NO se propone', () => {
    it('sin evidencia suficiente', async () => {
      const { insight } = await seedInsight();
      await prisma.insightEvidence.deleteMany({
        where: { insightId: insight.id },
      });
      await prisma.insight.update({
        where: { id: insight.id },
        data: { transitiveEvidenceClosure: [] },
      });

      expect(await propose()).toBe(0);
    });

    it('con confianza baja', async () => {
      await seedInsight({ confidence: 0.3 });
      expect(await propose()).toBe(0);
    });

    it('sobre una conclusión que ya no está vigente', async () => {
      const { insight } = await seedInsight();
      await prisma.insight.update({
        where: { id: insight.id },
        data: { status: 'SUPERSEDED' },
      });

      // Una propuesta sobre conocimiento obsoleto es peor que ninguna: parece vigente.
      expect(await propose()).toBe(0);
    });

    it('sobre una observación, que no articula una acción', async () => {
      await seedInsight({ type: 'PATTERN' });
      expect(await propose()).toBe(0);
    });

    it('cuando la evidencia no pertenece a ninguna colección — fail-closed', async () => {
      const sueltos = await Promise.all([
        createKnowledgeItem(org, { title: 'Suelto uno' }),
        createKnowledgeItem(org, { title: 'Suelto dos' }),
      ]);
      await createInsight(org, {
        subjectIdentity: 'sin-coleccion',
        type: 'RISK',
        confidence: 0.9,
        evidenceItemIds: sueltos.map((item) => item.id),
      });

      expect(await propose()).toBe(0);
    });

    it('cuando el modelo dice que no hay material', async () => {
      await seedInsight();

      // Es preferible cero recomendaciones a una inventada.
      expect(await propose('SIN_PROPUESTA')).toBe(0);
      expect(
        await prisma.recommendation.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(0);
    });

    it('cuando el modelo responde a medias', async () => {
      await seedInsight();

      const aMedias = JSON.stringify({
        title: FULL_PROPOSAL.title,
        detected: FULL_PROPOSAL.detected,
      });
      expect(await propose(aMedias)).toBe(0);
    });

    it('cuando el modelo devuelve basura', async () => {
      await seedInsight();
      expect(await propose('lo siento, no puedo ayudarte con eso')).toBe(0);
    });

    it('cuando el proveedor falla, el análisis no se rompe', async () => {
      const { insight } = await seedInsight();
      const roto = proposeFromInsights(db);
      // Se fuerza el fallo del proveedor sustituyendo su resolución.
      (
        roto as unknown as {
          providerRegistry: { resolveForOrganization: () => Promise<never> };
        }
      ).providerRegistry = {
        resolveForOrganization: () =>
          Promise.reject(new Error('proveedor caído')),
      };

      await expect(
        roto.execute({
          organizationId: org.orgId,
          analysisRunId: org.analysisRunId,
        }),
      ).resolves.toBe(0);

      // Y la conclusión sigue viva: lo que se comprendió no se pierde.
      expect(await prisma.insight.count({ where: { id: insight.id } })).toBe(1);
    });
  });

  describe('CRÍTICO: idempotencia', () => {
    it('analizar dos veces no duplica la propuesta', async () => {
      await seedInsight();

      expect(await propose()).toBe(1);
      expect(await propose()).toBe(0);

      expect(
        await prisma.recommendation.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(1);
    });

    it('una propuesta DESCARTADA no vuelve a proponerse', async () => {
      const { insight } = await seedInsight();
      await propose();

      const propuesta = await prisma.recommendation.findFirstOrThrow({
        where: { sourceInsightId: insight.id },
      });
      await recommendations.dismiss({
        organizationId: org.orgId,
        userId: org.userId,
        recommendationId: propuesta.id,
      });

      // La persona ya dijo que no: insistir cada noche sería acoso, no ayuda.
      expect(await propose()).toBe(0);
    });
  });

  describe('CRÍTICO: el alcance manda', () => {
    it('quien no tiene la colección NO recibe la propuesta', async () => {
      await seedInsight();
      await propose();

      const ajeno = await createMember(org, 'MEMBER');

      expect(
        await recommendations.list({
          organizationId: org.orgId,
          userId: ajeno,
        }),
      ).toHaveLength(0);
    });

    it('otra organización no la ve ni la alcanza', async () => {
      await seedInsight();
      await propose();
      const propuesta = await prisma.recommendation.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });
      const vecina = await createTestOrg('recomendaciones-vecina');

      expect(
        await recommendations.list({
          organizationId: vecina.orgId,
          userId: vecina.userId,
        }),
      ).toHaveLength(0);

      await expect(
        recommendations.findOne({
          organizationId: vecina.orgId,
          userId: vecina.userId,
          recommendationId: propuesta.id,
        }),
      ).rejects.toThrow();

      await destroyTestOrg(vecina);
    });
  });

  describe('la decisión humana', () => {
    const seedProposal = async () => {
      await seedInsight();
      await propose();
      return prisma.recommendation.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });
    };

    it('aceptar registra QUIÉN y CUÁNDO, sin ejecutar nada', async () => {
      const propuesta = await seedProposal();

      const resuelta = await recommendations.accept({
        organizationId: org.orgId,
        userId: org.userId,
        recommendationId: propuesta.id,
      });

      expect(resuelta.status).toBe('ACCEPTED');
      const guardada = await prisma.recommendation.findFirstOrThrow({
        where: { id: propuesta.id },
      });
      expect(guardada.resolvedById).toBe(org.userId);
      expect(guardada.resolvedAt).toBeInstanceOf(Date);

      const log = await prisma.auditLog.findFirstOrThrow({
        where: {
          organizationId: org.orgId,
          action: 'recommendation.accepted',
          targetId: propuesta.id,
        },
      });
      expect(log.actorId).toBe(org.userId);
    });

    it('CRÍTICO: aceptar NO deja la propuesta como ejecutada', async () => {
      const propuesta = await seedProposal();
      await recommendations.accept({
        organizationId: org.orgId,
        userId: org.userId,
        recommendationId: propuesta.id,
      });

      // Aceptada es una decisión, no un efecto. No existe estado "ejecutada" y no debe
      // existir: el sistema no ejecuta nada por su cuenta.
      const guardada = await prisma.recommendation.findFirstOrThrow({
        where: { id: propuesta.id },
      });
      expect(guardada.status).toBe('ACCEPTED');
      expect(['NEW', 'ACCEPTED', 'DISMISSED']).toContain(guardada.status);
    });

    it('CRÍTICO: no se puede aceptar dos veces', async () => {
      const propuesta = await seedProposal();
      await recommendations.accept({
        organizationId: org.orgId,
        userId: org.userId,
        recommendationId: propuesta.id,
      });

      await expect(
        recommendations.accept({
          organizationId: org.orgId,
          userId: org.userId,
          recommendationId: propuesta.id,
        }),
      ).rejects.toThrow();
    });

    it('CRÍTICO: descartar NO la borra del historial', async () => {
      const propuesta = await seedProposal();

      await recommendations.dismiss({
        organizationId: org.orgId,
        userId: org.userId,
        recommendationId: propuesta.id,
      });

      const guardada = await prisma.recommendation.findFirstOrThrow({
        where: { id: propuesta.id },
      });
      expect(guardada.status).toBe('DISMISSED');
      expect(guardada.resolvedById).toBe(org.userId);
      // Y sigue siendo consultable: la decisión forma parte de la historia.
      expect(
        await recommendations.list({
          organizationId: org.orgId,
          userId: org.userId,
          status: 'DISMISSED',
        }),
      ).toHaveLength(1);
    });
  });

  it('la propuesta lleva hasta la evidencia y hasta el documento', async () => {
    const { insight, items } = await seedInsight();
    await propose();

    const propuesta = await prisma.recommendation.findFirstOrThrow({
      where: { organizationId: org.orgId },
    });

    // Recomendación → conclusión…
    expect(propuesta.sourceInsightId).toBe(insight.id);
    // …→ evidencia → documento real.
    const evidencia = await prisma.insightEvidence.findMany({
      where: { insightId: insight.id },
    });
    expect(evidencia.map((e) => e.knowledgeItemId).sort()).toEqual(
      items.map((item) => item.id).sort(),
    );
  });
});

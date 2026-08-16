import { InsightStatus, InsightType } from '@businessbrain/database';
import { GenerativeSynthesisStrategy } from '../../src/understanding-engine/infrastructure/strategies/generative-synthesis.strategy';
import type { InsightCandidate } from '../../src/understanding-engine/domain/ports/reasoning-strategy.port';
import {
  as,
  createTenant,
  http,
  destroyTenant,
  prisma,
  startTestApp,
  stopTestApp,
  type TestActor,
  type TestTenant,
} from './harness';

/**
 * Fase 7 — memoria de la creencia, por HTTP y de extremo a extremo.
 *
 * Criterio de cierre: conocimiento → primer análisis → `Insight` → **evidencia nueva e
 * independiente** → segundo análisis → segunda versión → la primera queda `SUPERSEDED` →
 * historia por HTTP → trayectoria de confianza → atribución exacta del `KnowledgeItem` que
 * provocó el cambio.
 *
 * ## Qué se sustituye y por qué
 *
 * La estrategia generativa se sustituye por una determinista. **No es un atajo para que la
 * suite pase**: es la única forma de que el segundo análisis sea reproducible, porque la
 * generativa depende de un modelo cuya salida ya está doblada de todos modos.
 *
 * Sustituirla deja al descubierto algo que conviene decir sin rodeos: **hoy ninguna pareja
 * de estrategias reales puede reconciliar**, porque la generativa antepone su propia clave
 * a la identidad de sujeto (`generative-synthesis:…`) mientras las simbólicas la componen
 * por tipo de señal (`confidence-decay:knowledge-item:…`). Sus vocabularios de sujeto no se
 * cruzan nunca. El mecanismo de versionado que verifica esta suite es correcto y está
 * completo; lo que falta es un vocabulario canónico de sujeto que permita a dos estrategias
 * hablar del mismo asunto, y eso es una decisión de diseño, no un defecto que arreglar de
 * paso.
 *
 * Todo lo demás es la aplicación real: guards, controladores, transacciones y Postgres.
 */

/** Sujeto que la estrategia sustituta reclamará. Se fija por test. */
const target: {
  subjectIdentity: string | null;
  evidenceItemId: string | null;
} = { subjectIdentity: null, evidenceItemId: null };

/**
 * Estrategia independiente y determinista: llega al MISMO asunto desde OTRA evidencia.
 *
 * Es exactamente el caso que el modelo llama corroboración por evidencia independiente (§9):
 * otro mecanismo, otro documento, la misma conclusión.
 */
const independentStrategy = {
  key: 'e2e-corroboracion-independiente',
  version: '1.0.0',
  kind: 'SYMBOLIC' as const,
  baseReliability: 0.9,
  producibleTypes: [InsightType.ANOMALY],
  generate: (): Promise<InsightCandidate[]> =>
    Promise.resolve(
      target.subjectIdentity && target.evidenceItemId
        ? [
            {
              subjectIdentity: target.subjectIdentity,
              type: InsightType.ANOMALY,
              summary: 'Una segunda fuente confirma la misma anomalía.',
              evidence: [
                {
                  kind: 'KNOWLEDGE_ITEM' as const,
                  role: 'CORROBORATION' as const,
                  refId: target.evidenceItemId,
                },
              ],
              rawConfidence: 1,
              reasoningTrace: { rule: 'corroboración independiente e2e' },
            },
          ]
        : [],
    ),
};

describe('Memoria de la creencia (E2E)', () => {
  let tenant: TestTenant;
  const extraUsers: string[] = [];

  beforeAll(async () => {
    await startTestApp([
      { token: GenerativeSynthesisStrategy, value: independentStrategy },
    ]);
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    target.subjectIdentity = null;
    target.evidenceItemId = null;
    tenant = await createTenant('belief');
  });

  afterEach(async () => {
    await destroyTenant(tenant, extraUsers.splice(0));
  });

  /** Colección concedida a quien la pide: sin alcance no hay lectura (regla de cobertura). */
  const collectionFor = async (actor: TestActor, name: string) => {
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: tenant.organizationId, name },
    });
    await as(tenant.owner, tenant)
      .post(`/knowledge-collections/${collection.id}/access`)
      .send({ userId: actor.userId })
      .expect(201);
    return collection;
  };

  const knowledgeItem = async (params: {
    title: string;
    collectionId: string;
    confidenceScore: number;
  }) => {
    const source = await prisma.knowledgeSource.create({
      data: {
        organizationId: tenant.organizationId,
        type: 'FILE_UPLOAD',
        name: `Fuente ${params.title}`,
        connectorKey: 'file_upload_v1',
        createdById: tenant.owner.userId,
        status: 'CONNECTED',
        configEnc: '',
      },
    });
    const item = await prisma.knowledgeItem.create({
      data: {
        organizationId: tenant.organizationId,
        originKnowledgeSourceId: source.id,
        currentKnowledgeSourceId: source.id,
        title: params.title,
        contentText: `${params.title}. `.repeat(20),
        contentHash: `hash-${Math.random()}`,
        status: 'INDEXED',
        indexedAt: new Date(),
        businessArea: 'SALES',
        confidenceScore: params.confidenceScore,
        confidenceComputedAt: new Date(),
      },
    });
    await prisma.knowledgeItemCollection.create({
      data: {
        organizationId: tenant.organizationId,
        knowledgeItemId: item.id,
        knowledgeCollectionId: params.collectionId,
      },
    });
    return item;
  };

  it('CRITERIO DE CIERRE: una creencia cambia, la anterior sobrevive y la historia lo explica', async () => {
    const collection = await collectionFor(tenant.owner, 'Ventas');

    // 1. Conocimiento con la confianza bajo el piso: produce señal DETERMINISTA.
    const original = await knowledgeItem({
      title: 'Política de descuentos comerciales',
      collectionId: collection.id,
      confidenceScore: 0.05,
    });

    // 2. Primer análisis. Aquí razona el motor real.
    const firstRun = await as(tenant.owner, tenant)
      .post('/analysis-runs')
      .send({})
      .expect(201);
    expect(firstRun.body.data.insightsCreated).toBeGreaterThan(0);

    const afterFirst = await as(tenant.owner, tenant)
      .get('/insights')
      .expect(200);
    const firstVersion = afterFirst.body.data[0];
    expect(firstVersion.status).toBe('ACTIVE');
    const originalConfidence: number = firstVersion.confidence;

    // 3. Evidencia nueva e INDEPENDIENTE sobre el mismo asunto: otro documento, otro
    //    mecanismo. Repetir el mismo razonamiento sobre lo mismo no valdría (§9).
    const corroborating = await knowledgeItem({
      title: 'Auditoría externa de márgenes',
      collectionId: collection.id,
      confidenceScore: 0.9,
    });
    const subjectIdentity = (
      await prisma.insight.findFirstOrThrow({ where: { id: firstVersion.id } })
    ).subjectIdentity;
    target.subjectIdentity = subjectIdentity;
    target.evidenceItemId = corroborating.id;

    // 4. Segundo análisis: la creencia se mueve.
    await as(tenant.owner, tenant).post('/analysis-runs').send({}).expect(201);

    // 5. La primera versión NO se sobrescribió: sigue ahí, superada e intacta.
    const previous = await prisma.insight.findFirstOrThrow({
      where: { id: firstVersion.id },
    });
    expect(previous.status).toBe(InsightStatus.SUPERSEDED);
    expect(previous.confidence).toBe(originalConfidence);

    // 6. Nació una sucesora, encadenada a ella y con más confianza.
    const successor = await prisma.insight.findFirstOrThrow({
      where: { supersedesInsightId: firstVersion.id },
    });
    expect(successor.status).toBe(InsightStatus.ACTIVE);
    expect(successor.subjectIdentity).toBe(subjectIdentity);
    expect(successor.confidence).toBeGreaterThan(originalConfidence);

    // 7. La historia se lee POR HTTP, y cuenta la trayectoria completa.
    const history = await as(tenant.owner, tenant)
      .get(`/insights/${successor.id}/history`)
      .expect(200);

    const body = history.body.data;
    expect(body.subjectIdentity).toBe(subjectIdentity);
    expect(body.versions.map((v: { id: string }) => v.id)).toEqual([
      firstVersion.id,
      successor.id,
    ]);
    expect(body.hiddenVersionCount).toBe(0);

    // 8. Trayectoria de confianza y ATRIBUCIÓN EXACTA: qué documento movió la creencia.
    expect(body.transitions).toHaveLength(1);
    const [transition] = body.transitions;
    expect(transition.previousConfidence).toBe(originalConfidence);
    expect(transition.newConfidence).toBe(successor.confidence);
    expect(transition.confidenceDelta).toBeGreaterThan(0);
    expect(transition.changes).toEqual([
      {
        kind: 'ENTERED',
        ref: { kind: 'KNOWLEDGE_ITEM', refId: corroborating.id },
      },
    ]);
    expect(transition.changesOutOfScope).toBe(0);

    // La evidencia original sigue sosteniendo la creencia nueva: no se perdió al versionar.
    const closure = successor.transitiveEvidenceClosure as {
      refId: string;
    }[];
    expect(closure.map((entry) => entry.refId).sort()).toEqual(
      [original.id, corroborating.id].sort(),
    );

    // 9. El cambio de creencia deja traza, y la escribe el AuditService.
    const audit = await prisma.auditLog.findFirst({
      where: {
        organizationId: tenant.organizationId,
        action: 'insight.versioned',
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.targetId).toBe(successor.id);
  });

  it('la decisión humana sobrevive a que la máquina cambie de opinión (§3.7)', async () => {
    const collection = await collectionFor(tenant.owner, 'Ventas');
    await knowledgeItem({
      title: 'Política de descuentos comerciales',
      collectionId: collection.id,
      confidenceScore: 0.05,
    });

    await as(tenant.owner, tenant).post('/analysis-runs').send({}).expect(201);
    const primera = (
      await as(tenant.owner, tenant).get('/insights').expect(200)
    ).body.data[0];

    // Una persona valida la conclusión.
    await as(tenant.owner, tenant)
      .post(`/insights/${primera.id}/curate`)
      .send({ type: 'CONFIRMATION', comment: 'Correcto, hay que revisarlo.' })
      .expect(201);

    const confirmada = (
      await as(tenant.owner, tenant).get('/insights').expect(200)
    ).body.data[0];
    expect(confirmada.curation).toMatchObject({
      origin: 'OWN',
      curatedVersionId: primera.id,
    });

    // Evidencia nueva e independiente: la creencia se versiona.
    const corroborating = await knowledgeItem({
      title: 'Auditoría externa de márgenes',
      collectionId: collection.id,
      confidenceScore: 0.9,
    });
    target.subjectIdentity = (
      await prisma.insight.findFirstOrThrow({ where: { id: primera.id } })
    ).subjectIdentity;
    target.evidenceItemId = corroborating.id;
    await as(tenant.owner, tenant).post('/analysis-runs').send({}).expect(201);

    const viva = (await as(tenant.owner, tenant).get('/insights').expect(200))
      .body.data[0];
    expect(viva.id).not.toBe(primera.id);

    // El juicio humano NO se pierde, y viaja declarado como heredado: nunca se presenta
    // como si la persona se hubiera pronunciado sobre esta afirmación.
    expect(viva.curation).toMatchObject({
      type: 'CONFIRMATION',
      comment: 'Correcto, hay que revisarlo.',
      origin: 'INHERITED',
      curatedVersionId: primera.id,
      disputed: false,
    });

    // Y no autoriza a escalar: para proponer una acción hay que validar ESTA versión.
    await as(tenant.owner, tenant)
      .post(`/insights/${viva.id}/escalate`)
      .send({
        title: 'Revisar la política de descuentos',
        detected: 'La confianza del documento ha caído bajo el piso.',
        justification:
          'Una política desactualizada guía decisiones comerciales.',
        estimatedImpact: 'Recuperación de 3 puntos de margen.',
        advantages: 'Margen sostenible.',
        drawbacks: 'Requiere revisión manual.',
        affectedAreas: 'Ventas, Finanzas.',
        migrationPlan: 'no aplica (sin impacto estructural)',
      })
      .expect(409);
  });

  it('repetir el MISMO razonamiento sobre la MISMA evidencia no crea versión', async () => {
    const collection = await collectionFor(tenant.owner, 'Ventas');
    await knowledgeItem({
      title: 'Política de descuentos comerciales',
      collectionId: collection.id,
      confidenceScore: 0.05,
    });

    await as(tenant.owner, tenant).post('/analysis-runs').send({}).expect(201);
    // La estrategia sustituta no reclama ningún sujeto: solo corre la simbólica, dos veces.
    const second = await as(tenant.owner, tenant)
      .post('/analysis-runs')
      .send({})
      .expect(201);

    expect(second.body.data.insightsCreated).toBe(0);
    expect(second.body.data.insightsAlreadyKnown).toBeGreaterThan(0);
    expect(
      await prisma.insight.count({
        where: { organizationId: tenant.organizationId },
      }),
    ).toBe(1);

    const insight = await prisma.insight.findFirstOrThrow({
      where: { organizationId: tenant.organizationId },
    });
    const history = await as(tenant.owner, tenant)
      .get(`/insights/${insight.id}/history`)
      .expect(200);
    expect(history.body.data.versions).toHaveLength(1);
    expect(history.body.data.transitions).toEqual([]);
  });

  it('la historia de otra organización no existe', async () => {
    const collection = await collectionFor(tenant.owner, 'Ventas');
    await knowledgeItem({
      title: 'Política de descuentos comerciales',
      collectionId: collection.id,
      confidenceScore: 0.05,
    });
    await as(tenant.owner, tenant).post('/analysis-runs').send({}).expect(201);
    const insight = await prisma.insight.findFirstOrThrow({
      where: { organizationId: tenant.organizationId },
    });

    const rival = await createTenant('belief-rival');
    // Desde fuera del tenant no debe poder distinguirse "no es tuyo" de "no existe".
    await as(rival.owner, rival)
      .get(`/insights/${insight.id}/history`)
      .expect(404);
    await destroyTenant(rival);
  });

  it('sin sesión no se lee ninguna historia', async () => {
    const collection = await collectionFor(tenant.owner, 'Ventas');
    await knowledgeItem({
      title: 'Política de descuentos comerciales',
      collectionId: collection.id,
      confidenceScore: 0.05,
    });
    await as(tenant.owner, tenant).post('/analysis-runs').send({}).expect(201);
    const insight = await prisma.insight.findFirstOrThrow({
      where: { organizationId: tenant.organizationId },
    });

    await http().get(`/insights/${insight.id}/history`).expect(401);
  });
});

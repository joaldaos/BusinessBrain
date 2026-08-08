import {
  InsightStatus,
  InsightType,
  MembershipRole,
  RecommendationStatus,
} from '@businessbrain/database';
import { CollectionAccessService } from '../../src/knowledge-engine/application/collection-access.service';
import { RecommendationsService } from '../../src/recommendations/application/recommendations.service';
import { CurateInsightUseCase } from '../../src/understanding-engine/application/curate-insight.use-case';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  createInsight,
  createKnowledgeItem,
  createMember,
  createTestOrg,
  destroyTestOrg,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * Fase 5, subfase 5.8 — ciclo de vida y superficie de `Recommendation`.
 *
 * Lo que un doble no puede demostrar: que el `effectiveCollectionScope` persistido se
 * compara contra concesiones REALES, que la cobertura parcial deniega de verdad, y que
 * aceptar deja constancia de quién y cuándo sin tocar nada más. El alcance es lo único que
 * separa una propuesta sostenida por evidencia restringida de que la vea toda la
 * organización; si aquí se pierde, ninguna capa superior lo recupera.
 */
describe('Recommendations (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let access: CollectionAccessService;
  let recommendations: RecommendationsService;
  let curate: CurateInsightUseCase;

  beforeEach(async () => {
    org = await createTestOrg('rec-int');
    access = new CollectionAccessService(db);
    recommendations = new RecommendationsService(db, access);
    curate = new CurateInsightUseCase(db);
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const createCollection = (target: TestOrg, name: string) =>
    prisma.knowledgeCollection.create({
      data: { organizationId: target.orgId, name },
    });

  /**
   * Siembra una `Recommendation` REAL: escala un `Insight` con evidencia en colecciones
   * concretas, que es la única vía por la que nacen (§11, §12). No se insertan a mano para
   * que el `effectiveCollectionScope` sea el que el sistema calcula, no uno inventado.
   */
  const escalateFromCollections = async (
    target: TestOrg,
    collectionIds: string[],
    title = 'Revisar la política de descuentos',
  ) => {
    const items = await Promise.all(
      collectionIds.map(() => createKnowledgeItem(target)),
    );
    await Promise.all(
      items.map((item, index) =>
        prisma.knowledgeItemCollection.create({
          data: {
            organizationId: target.orgId,
            knowledgeItemId: item.id,
            knowledgeCollectionId: collectionIds[index],
          },
        }),
      ),
    );

    const insight = await createInsight(target, {
      subjectIdentity: `sujeto-${Math.random()}`,
      type: InsightType.RISK,
      status: InsightStatus.ACTIVE,
      evidenceItemIds: items.map((item) => item.id),
    });

    return curate.escalateToRecommendation({
      organizationId: target.orgId,
      insightId: insight.id,
      contract: {
        title,
        detected: 'Descuentos por encima del margen objetivo.',
        justification: 'El margen cae por debajo del umbral declarado.',
        estimatedImpact: 'Recuperación de 3 puntos de margen.',
        advantages: 'Margen sostenible.',
        drawbacks: 'Posible fricción comercial.',
        affectedAreas: 'Ventas, Finanzas.',
        migrationPlan: 'no aplica (sin impacto estructural)',
      },
    });
  };

  // ── 1. Acceso completo al effectiveCollectionScope → puede leer ───────────
  describe('acceso completo', () => {
    it('un usuario que cubre todo el alcance puede leer la recomendación', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const finanzas = await createCollection(org, 'Finanzas');
      const recommendation = await escalateFromCollections(org, [
        ventas.id,
        finanzas.id,
      ]);
      expect(recommendation.effectiveCollectionScope.sort()).toEqual(
        [ventas.id, finanzas.id].sort(),
      );

      const reader = await createMember(org, MembershipRole.MEMBER);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: reader,
        grantedById: org.userId,
      });
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: finanzas.id,
        userId: reader,
        grantedById: org.userId,
      });

      const found = await recommendations.findOne({
        organizationId: org.orgId,
        userId: reader,
        recommendationId: recommendation.id,
      });
      expect(found.id).toBe(recommendation.id);

      const list = await recommendations.list({
        organizationId: org.orgId,
        userId: reader,
      });
      expect(list.map((r) => r.id)).toEqual([recommendation.id]);
    });

    it('cubrir de más también permite leer', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const extra = await createCollection(org, 'Marketing');
      const recommendation = await escalateFromCollections(org, [ventas.id]);
      const reader = await createMember(org, MembershipRole.MEMBER);

      for (const collectionId of [ventas.id, extra.id]) {
        await access.grant({
          organizationId: org.orgId,
          knowledgeCollectionId: collectionId,
          userId: reader,
          grantedById: org.userId,
        });
      }

      await expect(
        recommendations.findOne({
          organizationId: org.orgId,
          userId: reader,
          recommendationId: recommendation.id,
        }),
      ).resolves.toMatchObject({ id: recommendation.id });
    });
  });

  // ── 2. Acceso parcial → denegado ─────────────────────────────────────────
  describe('acceso parcial', () => {
    it('DENIEGA a quien cubre solo una parte del alcance', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const rrhh = await createCollection(org, 'RR. HH.');
      const recommendation = await escalateFromCollections(org, [
        ventas.id,
        rrhh.id,
      ]);

      const partial = await createMember(org, MembershipRole.MEMBER);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: partial,
        grantedById: org.userId,
      });

      // La cobertura debe ser COMPLETA: ver la mitad de la evidencia no da derecho a ver
      // la conclusión que solo existe por la combinación de ambas.
      await expect(
        recommendations.findOne({
          organizationId: org.orgId,
          userId: partial,
          recommendationId: recommendation.id,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('el acceso parcial tampoco la ve en el listado', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const rrhh = await createCollection(org, 'RR. HH.');
      await escalateFromCollections(org, [ventas.id, rrhh.id]);

      const partial = await createMember(org, MembershipRole.MEMBER);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: partial,
        grantedById: org.userId,
      });

      // No se listan "bloqueadas": un listado que revelara título y motivo filtraría justo
      // lo que el alcance protege.
      expect(
        await recommendations.list({
          organizationId: org.orgId,
          userId: partial,
        }),
      ).toHaveLength(0);
    });

    it('el acceso parcial no puede aceptar ni descartar', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const rrhh = await createCollection(org, 'RR. HH.');
      const recommendation = await escalateFromCollections(org, [
        ventas.id,
        rrhh.id,
      ]);
      const partial = await createMember(org, MembershipRole.MEMBER);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: partial,
        grantedById: org.userId,
      });

      await expect(
        recommendations.accept({
          organizationId: org.orgId,
          userId: partial,
          recommendationId: recommendation.id,
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        recommendations.dismiss({
          organizationId: org.orgId,
          userId: partial,
          recommendationId: recommendation.id,
        }),
      ).rejects.toMatchObject({ status: 403 });

      const untouched = await prisma.recommendation.findUnique({
        where: { id: recommendation.id },
      });
      expect(untouched?.status).toBe(RecommendationStatus.NEW);
      expect(untouched?.resolvedById).toBeNull();
    });

    it('revocar una concesión retira el acceso que antes tenía', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const recommendation = await escalateFromCollections(org, [ventas.id]);
      const reader = await createMember(org, MembershipRole.MEMBER);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: reader,
        grantedById: org.userId,
      });

      await expect(
        recommendations.findOne({
          organizationId: org.orgId,
          userId: reader,
          recommendationId: recommendation.id,
        }),
      ).resolves.toBeDefined();

      await access.revoke({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: reader,
      });

      await expect(
        recommendations.findOne({
          organizationId: org.orgId,
          userId: reader,
          recommendationId: recommendation.id,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  // ── 3. Sin acceso → denegado ─────────────────────────────────────────────
  describe('sin acceso', () => {
    it('DENIEGA a un miembro sin ninguna concesión', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const recommendation = await escalateFromCollections(org, [ventas.id]);
      const outsider = await createMember(org, MembershipRole.MEMBER);

      // El acceso se concede, nunca se presupone: ninguna concesión = ninguna colección.
      await expect(
        recommendations.findOne({
          organizationId: org.orgId,
          userId: outsider,
          recommendationId: recommendation.id,
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await recommendations.list({
          organizationId: org.orgId,
          userId: outsider,
        }),
      ).toHaveLength(0);
    });

    it('DENIEGA incluso al OWNER si no tiene la colección concedida', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const recommendation = await escalateFromCollections(org, [ventas.id]);

      // El rol no sustituye al alcance: son dos controles distintos y el alcance no se
      // hereda del cargo.
      await expect(
        recommendations.findOne({
          organizationId: org.orgId,
          userId: org.userId,
          recommendationId: recommendation.id,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('DENIEGA una recomendación con alcance VACÍO aunque se tenga todo concedido', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const reader = await createMember(org, MembershipRole.MEMBER);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: reader,
        grantedById: org.userId,
      });

      // Evidencia sin colección: alcance vacío. Tratarlo como "sin restricciones"
      // convertiría el fallo más silencioso en acceso universal.
      const orphan = await escalateFromCollections(org, []);
      expect(orphan.effectiveCollectionScope).toEqual([]);

      await expect(
        recommendations.findOne({
          organizationId: org.orgId,
          userId: reader,
          recommendationId: orphan.id,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  // ── 4 y 5. Aceptar y descartar registran resolvedById y resolvedAt ───────
  describe('decisión humana', () => {
    const seedReadable = async () => {
      const ventas = await createCollection(org, 'Ventas');
      const recommendation = await escalateFromCollections(org, [ventas.id]);
      const decider = await createMember(org, MembershipRole.MEMBER);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: decider,
        grantedById: org.userId,
      });

      return { recommendation, decider };
    };

    it('aceptar registra `resolvedById` y `resolvedAt`', async () => {
      const { recommendation, decider } = await seedReadable();
      const before = new Date();

      const accepted = await recommendations.accept({
        organizationId: org.orgId,
        userId: decider,
        recommendationId: recommendation.id,
      });

      expect(accepted.status).toBe(RecommendationStatus.ACCEPTED);
      expect(accepted.resolvedById).toBe(decider);
      expect(accepted.resolvedAt).toBeInstanceOf(Date);
      expect(accepted.resolvedAt!.getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 1000,
      );

      const persisted = await prisma.recommendation.findUnique({
        where: { id: recommendation.id },
        include: { resolvedBy: true },
      });
      expect(persisted?.resolvedById).toBe(decider);
      expect(persisted?.resolvedBy?.id).toBe(decider);
    });

    it('descartar registra `resolvedById` y `resolvedAt`', async () => {
      const { recommendation, decider } = await seedReadable();

      const dismissed = await recommendations.dismiss({
        organizationId: org.orgId,
        userId: decider,
        recommendationId: recommendation.id,
      });

      expect(dismissed.status).toBe(RecommendationStatus.DISMISSED);
      expect(dismissed.resolvedById).toBe(decider);
      expect(dismissed.resolvedAt).toBeInstanceOf(Date);
    });

    it('una decisión ya tomada no se sobrescribe silenciosamente', async () => {
      const { recommendation, decider } = await seedReadable();
      await recommendations.accept({
        organizationId: org.orgId,
        userId: decider,
        recommendationId: recommendation.id,
      });

      const other = await createMember(org, MembershipRole.ADMIN);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: recommendation.effectiveCollectionScope[0],
        userId: other,
        grantedById: org.userId,
      });

      // Sobrescribir borraría quién decidió y cuándo, que es justo lo que 5.8 conserva.
      await expect(
        recommendations.dismiss({
          organizationId: org.orgId,
          userId: other,
          recommendationId: recommendation.id,
        }),
      ).rejects.toMatchObject({ status: 409 });

      const persisted = await prisma.recommendation.findUnique({
        where: { id: recommendation.id },
      });
      expect(persisted?.resolvedById).toBe(decider);
      expect(persisted?.status).toBe(RecommendationStatus.ACCEPTED);
    });

    it('la decisión sobrevive a la baja de quien la tomó', async () => {
      const { recommendation, decider } = await seedReadable();
      await recommendations.accept({
        organizationId: org.orgId,
        userId: decider,
        recommendationId: recommendation.id,
      });

      await prisma.user.delete({ where: { id: decider } });

      // `SetNull`: se pierde el quién, no la decisión ni el cuándo.
      const persisted = await prisma.recommendation.findUnique({
        where: { id: recommendation.id },
      });
      expect(persisted?.status).toBe(RecommendationStatus.ACCEPTED);
      expect(persisted?.resolvedById).toBeNull();
      expect(persisted?.resolvedAt).not.toBeNull();
    });

    it('registra la TRANSICIÓN completa: quién, cuándo, estado anterior y estado nuevo', async () => {
      const { recommendation, decider } = await seedReadable();

      await recommendations.accept({
        organizationId: org.orgId,
        userId: decider,
        recommendationId: recommendation.id,
      });

      const logs = await prisma.auditLog.findMany({
        where: {
          organizationId: org.orgId,
          targetType: 'Recommendation',
          targetId: recommendation.id,
        },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('recommendation.accepted');
      expect(logs[0].actorId).toBe(decider);
      expect(logs[0].metadata).toMatchObject({
        previousStatus: RecommendationStatus.NEW,
        newStatus: RecommendationStatus.ACCEPTED,
        // Constancia explícita de que la decisión no disparó nada fuera del sistema.
        externalActionExecuted: false,
      });
    });

    it('descartar registra su propia transición NEW → DISMISSED', async () => {
      const { recommendation, decider } = await seedReadable();

      await recommendations.dismiss({
        organizationId: org.orgId,
        userId: decider,
        recommendationId: recommendation.id,
      });

      const log = await prisma.auditLog.findFirst({
        where: { targetType: 'Recommendation', targetId: recommendation.id },
      });
      expect(log?.action).toBe('recommendation.dismissed');
      expect(log?.metadata).toMatchObject({
        previousStatus: RecommendationStatus.NEW,
        newStatus: RecommendationStatus.DISMISSED,
      });
    });

    it('dos resoluciones SIMULTÁNEAS: solo una gana y ninguna decisión se pierde', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const recommendation = await escalateFromCollections(org, [ventas.id]);

      const first = await createMember(org, MembershipRole.MEMBER);
      const second = await createMember(org, MembershipRole.MEMBER);
      for (const userId of [first, second]) {
        await access.grant({
          organizationId: org.orgId,
          knowledgeCollectionId: ventas.id,
          userId,
          grantedById: org.userId,
        });
      }

      // Comprobar el estado y despues actualizar dejaría una ventana entre ambas
      // operaciones: las dos leerían NEW, las dos pasarían la comprobación y la segunda
      // escritura pisaría a la primera, borrando en silencio una decisión humana.
      const outcomes = await Promise.allSettled([
        recommendations.accept({
          organizationId: org.orgId,
          userId: first,
          recommendationId: recommendation.id,
        }),
        recommendations.dismiss({
          organizationId: org.orgId,
          userId: second,
          recommendationId: recommendation.id,
        }),
      ]);

      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o) => o.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({
        status: 409,
      });

      // El resolutor persistido es exactamente el de la decisión que ganó, y solo se
      // registró una transición.
      const persisted = await prisma.recommendation.findUnique({
        where: { id: recommendation.id },
      });
      const winner = (
        fulfilled[0] as PromiseFulfilledResult<{
          resolvedById: string | null;
          status: RecommendationStatus;
        }>
      ).value;
      expect(persisted?.resolvedById).toBe(winner.resolvedById);
      expect(persisted?.status).toBe(winner.status);
      expect(
        await prisma.auditLog.count({
          where: { targetType: 'Recommendation', targetId: recommendation.id },
        }),
      ).toBe(1);
    });

    it('una recomendación recién escalada nace SIN resolutor', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const recommendation = await escalateFromCollections(org, [ventas.id]);

      expect(recommendation.status).toBe(RecommendationStatus.NEW);
      expect(recommendation.resolvedById).toBeNull();
      expect(recommendation.resolvedAt).toBeNull();
    });
  });

  // ── 6. Aceptar no ejecuta ninguna tool ni acción externa ─────────────────
  describe('aceptar no ejecuta nada', () => {
    it('aceptar no produce ejecuciones, conversaciones ni automatizaciones', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const recommendation = await escalateFromCollections(org, [ventas.id]);
      const decider = await createMember(org, MembershipRole.MEMBER);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: decider,
        grantedById: org.userId,
      });

      await recommendations.accept({
        organizationId: org.orgId,
        userId: decider,
        recommendationId: recommendation.id,
      });

      // Ningún efecto fuera del propio registro: ni ejecuciones de herramienta, ni turnos
      // de agente, ni automatizaciones, ni ejecuciones de automatización.
      expect(
        await prisma.auditLog.count({
          where: {
            organizationId: org.orgId,
            action: { startsWith: 'agent.tool' },
          },
        }),
      ).toBe(0);
      expect(
        await prisma.conversation.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(0);
      expect(
        await prisma.automation.count({ where: { organizationId: org.orgId } }),
      ).toBe(0);
      expect(
        await prisma.agent.count({ where: { organizationId: org.orgId } }),
      ).toBe(0);
    });

    it('aceptar solo cambia estado, resolutor y fecha: el contrato queda intacto', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const recommendation = await escalateFromCollections(org, [ventas.id]);
      const decider = await createMember(org, MembershipRole.MEMBER);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: decider,
        grantedById: org.userId,
      });

      const accepted = await recommendations.accept({
        organizationId: org.orgId,
        userId: decider,
        recommendationId: recommendation.id,
      });

      // Los seis puntos del Principio de Evolución Asistida siguen siendo los mismos.
      expect(accepted.detected).toBe(recommendation.detected);
      expect(accepted.justification).toBe(recommendation.justification);
      expect(accepted.estimatedImpact).toBe(recommendation.estimatedImpact);
      expect(accepted.advantages).toBe(recommendation.advantages);
      expect(accepted.drawbacks).toBe(recommendation.drawbacks);
      expect(accepted.affectedAreas).toBe(recommendation.affectedAreas);
      expect(accepted.migrationPlan).toBe(recommendation.migrationPlan);
      expect(accepted.effectiveCollectionScope).toEqual(
        recommendation.effectiveCollectionScope,
      );
    });

    it('el módulo no expone ninguna vía de creación de recomendaciones', () => {
      // Un generador paralelo sería el riesgo que §11 cierra: dos mecanismos resolviendo
      // "proponer algo a la empresa", uno de ellos sin trazabilidad hasta la comprensión.
      const surface = Object.getOwnPropertyNames(
        Object.getPrototypeOf(recommendations),
      );
      expect(surface).not.toContain('create');
      expect(surface).not.toContain('generate');
      expect(surface.filter((m) => !m.startsWith('_'))).toEqual(
        expect.arrayContaining(['list', 'findOne', 'accept', 'dismiss']),
      );
    });
  });

  // ── 7. sourceInsightId permanece trazable ────────────────────────────────
  describe('trazabilidad hasta la comprensión de origen', () => {
    it('conserva `sourceInsightId` y permite resolver el Insight', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const recommendation = await escalateFromCollections(org, [ventas.id]);
      const reader = await createMember(org, MembershipRole.MEMBER);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: reader,
        grantedById: org.userId,
      });

      const view = await recommendations.findOne({
        organizationId: org.orgId,
        userId: reader,
        recommendationId: recommendation.id,
      });

      expect(view.sourceInsightId).toBe(recommendation.sourceInsightId);
      expect(view.sourceInsight?.id).toBe(recommendation.sourceInsightId);
      expect(view.sourceInsight?.status).toBe(InsightStatus.ACTIVE);
    });

    it('`sourceInsightId` sobrevive a aceptar y a descartar', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const recommendation = await escalateFromCollections(org, [ventas.id]);
      const decider = await createMember(org, MembershipRole.MEMBER);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: decider,
        grantedById: org.userId,
      });

      const accepted = await recommendations.accept({
        organizationId: org.orgId,
        userId: decider,
        recommendationId: recommendation.id,
      });

      expect(accepted.sourceInsightId).toBe(recommendation.sourceInsightId);
      expect(accepted.sourceInsight?.id).toBe(recommendation.sourceInsightId);
    });

    it('sigue siendo legible si el Insight de origen se descarta después', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const recommendation = await escalateFromCollections(org, [ventas.id]);
      const reader = await createMember(org, MembershipRole.MEMBER);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: reader,
        grantedById: org.userId,
      });

      await prisma.insight.update({
        where: { id: recommendation.sourceInsightId! },
        data: { status: InsightStatus.DISCARDED },
      });

      // Sin esta referencia sería imposible saber que una propuesta pendiente se apoya en
      // comprensión que ya colapsó (§21, hallazgo 12).
      const view = await recommendations.findOne({
        organizationId: org.orgId,
        userId: reader,
        recommendationId: recommendation.id,
      });
      expect(view.sourceInsight?.status).toBe(InsightStatus.DISCARDED);
    });
  });

  // ── 8. Una Recommendation de otra organización nunca es visible ──────────
  describe('aislamiento entre organizaciones', () => {
    it('una recomendación de otra organización no aparece ni se lee', async () => {
      const other = await createTestOrg('rec-int-b');
      const theirCollection = await createCollection(other, 'Ventas ajenas');
      const theirs = await escalateFromCollections(other, [theirCollection.id]);

      // Fuera del tenant no debe distinguirse "no existe" de "no es tuya".
      await expect(
        recommendations.findOne({
          organizationId: org.orgId,
          userId: org.userId,
          recommendationId: theirs.id,
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        await recommendations.list({
          organizationId: org.orgId,
          userId: org.userId,
        }),
      ).toHaveLength(0);

      await destroyTestOrg(other);
    });

    it('no se puede aceptar ni descartar la recomendación de otra organización', async () => {
      const other = await createTestOrg('rec-int-c');
      const theirCollection = await createCollection(other, 'Ventas ajenas');
      const theirs = await escalateFromCollections(other, [theirCollection.id]);

      await expect(
        recommendations.accept({
          organizationId: org.orgId,
          userId: org.userId,
          recommendationId: theirs.id,
        }),
      ).rejects.toMatchObject({ status: 404 });

      const untouched = await prisma.recommendation.findUnique({
        where: { id: theirs.id },
      });
      expect(untouched?.status).toBe(RecommendationStatus.NEW);
      expect(untouched?.resolvedById).toBeNull();

      await destroyTestOrg(other);
    });

    it('coincidir en ids de colección no abre acceso entre organizaciones', async () => {
      const other = await createTestOrg('rec-int-d');
      const theirCollection = await createCollection(other, 'Ventas ajenas');
      const theirs = await escalateFromCollections(other, [theirCollection.id]);

      // Conceder al usuario propio la colección AJENA es imposible: la FK compuesta contra
      // (id, organizationId) lo impide por construcción, no por una comprobación olvidable.
      await expect(
        access.grant({
          organizationId: org.orgId,
          knowledgeCollectionId: theirCollection.id,
          userId: org.userId,
          grantedById: org.userId,
        }),
      ).rejects.toThrow(/otra organización|inexistente/i);

      await expect(
        recommendations.findOne({
          organizationId: org.orgId,
          userId: org.userId,
          recommendationId: theirs.id,
        }),
      ).rejects.toMatchObject({ status: 404 });

      await destroyTestOrg(other);
    });

    it('el listado de una organización nunca mezcla recomendaciones de otra', async () => {
      const mine = await createCollection(org, 'Ventas');
      const recommendation = await escalateFromCollections(org, [mine.id]);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: mine.id,
        userId: org.userId,
        grantedById: org.userId,
      });

      const other = await createTestOrg('rec-int-e');
      const theirCollection = await createCollection(other, 'Ventas ajenas');
      await escalateFromCollections(other, [theirCollection.id]);

      const list = await recommendations.list({
        organizationId: org.orgId,
        userId: org.userId,
      });
      expect(list.map((r) => r.id)).toEqual([recommendation.id]);

      await destroyTestOrg(other);
    });
  });

  // ── Paginación aplicada en Postgres (5.9) ────────────────────────────────
  describe('paginación', () => {
    /** N recomendaciones legibles por `reader`, en la misma colección. */
    const seedMany = async (count: number) => {
      const ventas = await createCollection(org, 'Ventas');
      const reader = await createMember(org, MembershipRole.MEMBER);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: reader,
        grantedById: org.userId,
      });

      const created: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const rec = await escalateFromCollections(
          org,
          [ventas.id],
          `Propuesta ${i}`,
        );
        created.push(rec.id);
      }
      return { reader, ventas, created };
    };

    it('el `limit` acota la página y el `offset` la desplaza', async () => {
      const { reader } = await seedMany(5);

      const firstPage = await recommendations.list({
        organizationId: org.orgId,
        userId: reader,
        limit: 2,
      });
      const secondPage = await recommendations.list({
        organizationId: org.orgId,
        userId: reader,
        limit: 2,
        offset: 2,
      });

      expect(firstPage).toHaveLength(2);
      expect(secondPage).toHaveLength(2);
      // Páginas disjuntas: el desplazamiento ocurre en la consulta, no en memoria.
      const ids = new Set([...firstPage, ...secondPage].map((r) => r.id));
      expect(ids.size).toBe(4);
    });

    it('recorrer todas las páginas devuelve exactamente el conjunto accesible', async () => {
      const { reader, created } = await seedMany(5);

      const seen: string[] = [];
      for (let offset = 0; offset < 10; offset += 2) {
        const page = await recommendations.list({
          organizationId: org.orgId,
          userId: reader,
          limit: 2,
          offset,
        });
        seen.push(...page.map((r) => r.id));
        if (page.length === 0) break;
      }

      expect([...new Set(seen)].sort()).toEqual([...created].sort());
    });

    it('la paginación NO abre acceso a lo que el alcance deniega', async () => {
      const { reader, ventas } = await seedMany(2);
      const rrhh = await createCollection(org, 'RR. HH.');
      // Una recomendación que exige DOS colecciones; `reader` solo tiene una.
      const restricted = await escalateFromCollections(org, [
        ventas.id,
        rrhh.id,
      ]);

      const all: string[] = [];
      for (let offset = 0; offset < 10; offset += 1) {
        const page = await recommendations.list({
          organizationId: org.orgId,
          userId: reader,
          limit: 1,
          offset,
        });
        if (page.length === 0) break;
        all.push(...page.map((r) => r.id));
      }

      // Ninguna página, en ningún desplazamiento, la deja aparecer.
      expect(all).not.toContain(restricted.id);
    });

    it('el alcance vacío sigue siendo inaccesible con paginación', async () => {
      const { reader } = await seedMany(1);
      const orphan = await escalateFromCollections(org, []);

      const page = await recommendations.list({
        organizationId: org.orgId,
        userId: reader,
        limit: 50,
      });

      expect(page.map((r) => r.id)).not.toContain(orphan.id);
    });

    it('la paginación nunca cruza la frontera de organización', async () => {
      const { reader } = await seedMany(2);
      const other = await createTestOrg('rec-int-pag');
      const theirCollection = await createCollection(other, 'Ventas ajenas');
      await escalateFromCollections(other, [theirCollection.id]);

      const page = await recommendations.list({
        organizationId: org.orgId,
        userId: reader,
        limit: 50,
      });

      expect(page.every((r) => r.organizationId === org.orgId)).toBe(true);

      await destroyTestOrg(other);
    });

    it('un usuario sin concesiones no ve nada, pagine como pagine', async () => {
      await seedMany(3);
      const nobody = await createMember(org, MembershipRole.ADMIN);

      expect(
        await recommendations.list({
          organizationId: org.orgId,
          userId: nobody,
          limit: 50,
        }),
      ).toHaveLength(0);
    });

    it('filtra por estado dentro de la propia página', async () => {
      const { reader, created } = await seedMany(3);
      await recommendations.accept({
        organizationId: org.orgId,
        userId: reader,
        recommendationId: created[0],
      });

      const nuevas = await recommendations.list({
        organizationId: org.orgId,
        userId: reader,
        status: RecommendationStatus.NEW,
      });
      const aceptadas = await recommendations.list({
        organizationId: org.orgId,
        userId: reader,
        status: RecommendationStatus.ACCEPTED,
      });

      expect(nuevas).toHaveLength(2);
      expect(aceptadas.map((r) => r.id)).toEqual([created[0]]);
    });
  });

  // ── Concesiones: garantías del modelo de acceso ──────────────────────────
  describe('concesión de acceso a colecciones', () => {
    it('conceder es idempotente y conserva la traza original', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const reader = await createMember(org, MembershipRole.MEMBER);

      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: reader,
        grantedById: org.userId,
      });
      const first = await prisma.knowledgeCollectionAccess.findFirst({
        where: { knowledgeCollectionId: ventas.id, userId: reader },
      });

      const admin = await createMember(org, MembershipRole.ADMIN);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: reader,
        grantedById: admin,
      });

      const grants = await prisma.knowledgeCollectionAccess.findMany({
        where: { knowledgeCollectionId: ventas.id, userId: reader },
      });
      expect(grants).toHaveLength(1);
      expect(grants[0].grantedById).toBe(first?.grantedById);
    });

    it('no se concede a quien no pertenece a la organización', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const other = await createTestOrg('rec-int-f');

      await expect(
        access.grant({
          organizationId: org.orgId,
          knowledgeCollectionId: ventas.id,
          userId: other.userId,
          grantedById: org.userId,
        }),
      ).rejects.toMatchObject({ status: 403 });

      await destroyTestOrg(other);
    });

    it('salir de la organización revoca en cascada todo lo concedido', async () => {
      const ventas = await createCollection(org, 'Ventas');
      const leaver = await createMember(org, MembershipRole.MEMBER);
      await access.grant({
        organizationId: org.orgId,
        knowledgeCollectionId: ventas.id,
        userId: leaver,
        grantedById: org.userId,
      });

      await prisma.membership.delete({
        where: {
          userId_organizationId: {
            userId: leaver,
            organizationId: org.orgId,
          },
        },
      });

      // Un acceso que sobreviviera a la baja sería el permiso que nadie recuerda retirar.
      expect(
        await access.accessibleCollectionIds({
          organizationId: org.orgId,
          userId: leaver,
        }),
      ).toEqual([]);
    });

    it('sin concesiones, el alcance accesible es vacío, no total', async () => {
      const fresh = await createMember(org, MembershipRole.ADMIN);

      expect(
        await access.accessibleCollectionIds({
          organizationId: org.orgId,
          userId: fresh,
        }),
      ).toEqual([]);
    });
  });
});

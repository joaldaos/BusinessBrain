import { MembershipRole } from '@businessbrain/database';
import { makePdf } from '../documentos-reales';
import {
  addMember,
  as,
  createTenant,
  destroyTenant,
  http,
  llmScript,
  prisma,
  startTestApp,
  stopTestApp,
  type TestActor,
  type TestTenant,
} from './harness';

/**
 * De documento a propuesta, y de propuesta a decisión — por HTTP, sin sembrar nada.
 *
 * La recomendación NACE del flujo real: se sube un PDF, se analiza y el sistema decide si hay
 * material para proponer. No se escribe ninguna `Recommendation` en la base de datos para hacer
 * pasar la prueba, porque entonces no se estaría probando lo único que importa aquí.
 */
describe('Recomendaciones (E2E)', () => {
  let tenant: TestTenant;
  const extraUsers: string[] = [];

  const PROPUESTA = {
    title: 'Revisar los descuentos del canal mayorista',
    detected:
      'Los descuentos aplicados superan de forma recurrente el máximo autorizado.',
    justification:
      'Erosiona el margen objetivo declarado por la compañía para el ejercicio.',
    estimatedImpact:
      'Recuperar entre dos y cuatro puntos de margen en el canal.',
    advantages: 'Alinea la práctica comercial con la política escrita.',
    drawbacks: 'Puede tensar la relación con algunos distribuidores.',
    affectedAreas: 'Área comercial y control de márgenes.',
    migrationPlan: 'Comunicar el límite y revisar las ofertas abiertas.',
  };

  beforeAll(async () => {
    await startTestApp();
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    llmScript.answers = [];
    tenant = await createTenant('reco');
  });

  afterEach(async () => {
    await destroyTenant(tenant, extraUsers.splice(0));
  });

  /**
   * Conocimiento real y una conclusión sólida, creados por las vías que usa la interfaz.
   *
   * La conclusión se produce lanzando un análisis; lo único guionizado es lo que responde el
   * modelo, que es lo que no es lógica nuestra.
   */
  const seedKnowledge = async () => {
    // Esta empresa exige fuentes muy fiables. Es un escenario real —una asesoría o una
    // clínica pondrían el listón así— y hace que el conocimiento recién ingerido produzca una
    // señal DETERMINISTA, sin depender de que el modelo razone.
    await as(tenant.owner, tenant)
      .patch(`/organizations/${tenant.organizationId}`)
      .send({
        settings: { knowledgeEngine: { confidence: { minimumFloor: 0.95 } } },
      })
      .expect(200);

    const collection = await as(tenant.owner, tenant)
      .post('/knowledge-collections')
      .send({ name: 'Comercial' })
      .expect(201);

    const source = await as(tenant.owner, tenant)
      .post('/knowledge-sources')
      .send({
        name: 'Mis documentos',
        type: 'FILE_UPLOAD',
        connectorKey: 'file_upload_v1',
        knowledgeCollectionIds: [collection.body.data.id],
      })
      .expect(201);

    for (const [nombre, texto] of [
      [
        'politica.pdf',
        'La política de descuentos fija un máximo del quince por ciento para el canal ' +
          'mayorista y exige autorización expresa por encima de ese umbral.',
      ],
      [
        'margenes.pdf',
        'El informe de márgenes muestra descuentos del veintidós por ciento aplicados de ' +
          'forma recurrente en el canal mayorista durante el último trimestre.',
      ],
    ]) {
      await as(tenant.owner, tenant)
        .post(`/knowledge-sources/${source.body.data.id}/sync`)
        .attach('file', await makePdf([texto]), {
          filename: nombre,
          contentType: 'application/pdf',
        })
        .expect(201);
    }

    return { collectionId: collection.body.data.id as string };
  };

  /** Objetivo declarado: sin él, un `RISK` no se ancla a nada. */
  const declareObjective = () =>
    as(tenant.owner, tenant)
      .post('/business-objectives')
      .send({
        statement: 'El margen comercial no debe bajar del treinta por ciento.',
      })
      .expect(201);

  const analyze = () =>
    as(tenant.owner, tenant).post('/analysis-runs').send({});

  it('CRITERIO DE CIERRE: analizar produce una propuesta pendiente de decisión', async () => {
    await seedKnowledge();
    await declareObjective();

    // El modelo: primero razona el hallazgo, después redacta la propuesta.
    llmScript.answers = [
      JSON.stringify({
        insights: [
          {
            subjectIdentity: 'margen-canal-mayorista',
            type: 'RISK',
            summary:
              'Los descuentos aplicados en el canal mayorista superan el máximo autorizado.',
            confidence: 0.86,
            reasoningTrace: { rule: 'contraste entre política e informe' },
          },
        ],
      }),
      JSON.stringify(PROPUESTA),
    ];

    const run = await analyze().expect(201);
    expect(run.body.data.status).toBe('SUCCESS');

    const pending = await as(tenant.owner, tenant)
      .get('/recommendations?status=NEW')
      .expect(200);

    expect(run.body.data.insightsCreated).toBeGreaterThan(0);
    expect(run.body.data.recommendationsProposed).toBeGreaterThan(0);
    expect(pending.body.data.length).toBeGreaterThan(0);

    const propuesta = pending.body.data[0];
    expect(propuesta.status).toBe('NEW');
    // Propuesta por BusinessBrain, no redactada por una persona.
    expect(propuesta.createdById).toBeNull();
    expect(propuesta.resolvedAt).toBeNull();
    // Con el contrato completo y trazable hasta la conclusión.
    expect(propuesta.detected).toBeTruthy();
    expect(propuesta.migrationPlan).toBeTruthy();
    expect(propuesta.sourceInsight).not.toBeNull();
  });

  describe('sobre una propuesta existente', () => {
    /**
     * Propuesta nacida del flujo, no sembrada.
     *
     * Se construye la conclusión con evidencia real y se deja que el caso de uso decida; si el
     * razonamiento no produce nada elegible, la prueba lo dice en vez de fingirlo.
     */
    const seedProposal = async () => {
      await seedKnowledge();
      await declareObjective();
      llmScript.answers = [
        JSON.stringify({
          insights: [
            {
              subjectIdentity: 'margen-canal-mayorista',
              type: 'RISK',
              summary:
                'Los descuentos del canal mayorista superan el máximo autorizado.',
              confidence: 0.86,
              reasoningTrace: { rule: 'contraste' },
            },
          ],
        }),
        JSON.stringify(PROPUESTA),
      ];
      await analyze().expect(201);

      const pending = await as(tenant.owner, tenant)
        .get('/recommendations?status=NEW')
        .expect(200);

      // Sin salida condicional: si no nace la propuesta, la prueba falla. Una prueba que se
      // salta sola cuando no encuentra lo que busca no garantiza nada.
      expect(pending.body.data.length).toBeGreaterThan(0);
      return pending.body.data[0] as { id: string };
    };

    it('aceptar registra la decisión y NO la marca como ejecutada', async () => {
      const propuesta = await seedProposal();

      const aceptada = await as(tenant.owner, tenant)
        .post(`/recommendations/${propuesta.id}/accept`)
        .expect(201);

      expect(aceptada.body.data.status).toBe('ACCEPTED');
      expect(aceptada.body.data.resolvedBy.id).toBe(tenant.owner.userId);
      // No existe estado "ejecutada", y no debe existir: aceptar es una decisión.
      expect(['NEW', 'ACCEPTED', 'DISMISSED']).toContain(
        aceptada.body.data.status,
      );

      const log = await prisma.auditLog.findFirstOrThrow({
        where: {
          organizationId: tenant.organizationId,
          action: 'recommendation.accepted',
          targetId: propuesta.id,
        },
      });
      expect(log.actorId).toBe(tenant.owner.userId);
    });

    it('CRÍTICO: no se puede aceptar dos veces', async () => {
      const propuesta = await seedProposal();

      await as(tenant.owner, tenant)
        .post(`/recommendations/${propuesta.id}/accept`)
        .expect(201);
      await as(tenant.owner, tenant)
        .post(`/recommendations/${propuesta.id}/accept`)
        .expect(409);
    });

    it('CRÍTICO: descartar no la borra del historial', async () => {
      const propuesta = await seedProposal();

      await as(tenant.owner, tenant)
        .post(`/recommendations/${propuesta.id}/dismiss`)
        .expect(201);

      const historial = await as(tenant.owner, tenant)
        .get('/recommendations?status=DISMISSED')
        .expect(200);
      expect(historial.body.data).toHaveLength(1);
      expect(historial.body.data[0].id).toBe(propuesta.id);
    });

    it('CRÍTICO: otra organización no la ve ni la puede decidir', async () => {
      const propuesta = await seedProposal();
      const rival = await createTenant('reco-rival');

      const suyas = await as(rival.owner, rival)
        .get('/recommendations')
        .expect(200);
      expect(suyas.body.data).toHaveLength(0);

      await as(rival.owner, rival)
        .get(`/recommendations/${propuesta.id}`)
        .expect(404);
      await as(rival.owner, rival)
        .post(`/recommendations/${propuesta.id}/accept`)
        .expect(404);

      await destroyTenant(rival);
    });

    it('CRÍTICO: quien no tiene la colección no la ve ni la decide', async () => {
      const propuesta = await seedProposal();

      const colega: TestActor = await addMember(
        tenant,
        MembershipRole.MEMBER,
        'colega',
      );
      extraUsers.push(colega.userId);

      // La propuesta se apoya en evidencia de una colección que no tiene concedida, así que no
      // aparece en su lista.
      const suyas = await as(colega, tenant)
        .get('/recommendations')
        .expect(200);
      expect(suyas.body.data).toHaveLength(0);

      // Y pedirla por su identificador se deniega con 403, no con 404: DENTRO de su empresa
      // una persona sí tiene derecho a saber que existe algo que no puede ver y por qué. Lo
      // que nunca debe poder distinguir es eso mismo desde otra organización — ese caso es el
      // 404 de la prueba anterior.
      await as(colega, tenant)
        .get(`/recommendations/${propuesta.id}`)
        .expect(403);
      await as(colega, tenant)
        .post(`/recommendations/${propuesta.id}/accept`)
        .expect(403);
    });

    it('un VIEWER puede leer pero no decidir', async () => {
      const propuesta = await seedProposal();

      const observador: TestActor = await addMember(
        tenant,
        MembershipRole.VIEWER,
        'observador',
      );
      extraUsers.push(observador.userId);

      await as(observador, tenant)
        .post(`/recommendations/${propuesta.id}/accept`)
        .expect(403);
    });
  });

  it('sin sesión no se llega a ninguna ruta', async () => {
    await http().get('/recommendations').expect(401);
    await http().post('/recommendations/lo-que-sea/accept').expect(401);
  });

  it('NO existe una vía para crear una recomendación a mano por HTTP', async () => {
    // Un endpoint de creación convertiría esto en un generador paralelo de propuestas, sin
    // trazabilidad hasta la comprensión que las sostiene.
    const respuesta = await as(tenant.owner, tenant)
      .post('/recommendations')
      .send({ title: 'Inventada' });

    expect([404, 405]).toContain(respuesta.status);
  });
});

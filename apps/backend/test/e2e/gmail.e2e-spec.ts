import { MembershipRole } from '@businessbrain/database';
import { GMAIL_PORT } from '../../src/integrations/domain/ports/gmail.port';
import { GOOGLE_DRIVE_PORT } from '../../src/integrations/domain/ports/google-drive.port';
import { FakeGmail } from '../fake-gmail';
import { FakeGoogleDrive } from '../fake-google-drive';
import {
  addMember,
  as,
  createTenant,
  destroyTenant,
  http,
  prisma,
  startTestApp,
  stopTestApp,
  type TestActor,
  type TestTenant,
} from './harness';

/**
 * Gmail por HTTP, con el proveedor sustituido.
 *
 * Atraviesa la aplicación REAL —guards, firma del estado, cookies, controladores,
 * persistencia— y sustituye únicamente lo que es de Google. Es lo que permite verificar en CI
 * el flujo entero sin una cuenta real ni red.
 *
 * El callback de OAuth es la superficie más expuesta del sistema, y con Gmail lo que está al
 * otro lado es un buzón: buena parte de esta suite está escrita desde el lado del atacante.
 */
describe('Gmail (E2E)', () => {
  let tenant: TestTenant;
  /** Segundo miembro: sin él, "restringido" y "toda la organización" serían el mismo conjunto. */
  let otroMiembro: TestActor;
  const gmail = new FakeGmail();
  const extraUsers: string[] = [];

  const CORREO =
    'La política de descuentos comerciales supera el margen objetivo de forma recurrente en ' +
    'el segmento mayorista. Conviene revisar los umbrales antes del cierre del trimestre.';

  beforeAll(async () => {
    await startTestApp([
      { token: GMAIL_PORT, value: gmail },
      // Drive también se sustituye: comparte el módulo, y una llamada real no puede ocurrir
      // en CI. Ninguna prueba de esta suite lo ejercita.
      { token: GOOGLE_DRIVE_PORT, value: new FakeGoogleDrive() },
    ]);
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    tenant = await createTenant('gmail');
    otroMiembro = await addMember(tenant, MembershipRole.MEMBER, 'colega');
    extraUsers.push(otroMiembro.userId);
    gmail.historyExpired = false;
    gmail.calls.listMessages.length = 0;
    gmail.putMessage({ id: 'msg-1', body: CORREO });
  });

  afterEach(async () => {
    await destroyTenant(tenant, extraUsers.splice(0));
  });

  const cookieFrom = (
    headers: Record<string, string[] | string | undefined>,
    name: string,
  ): string | undefined => {
    const raw = headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.find((cookie) => cookie.startsWith(`${name}=`));
  };

  const stateFrom = (authorizationUrl: string): string =>
    new URL(authorizationUrl).searchParams.get('state')!;

  const startFlow = async (provider: 'gmail' | 'google-drive' = 'gmail') => {
    const started = await as(tenant.owner, tenant)
      .get(`/integrations/${provider}/connect`)
      .expect(200);

    return {
      nonceCookie: cookieFrom(started.headers, 'bb_oauth_nonce')!,
      state: stateFrom(
        (started.body as { data: { authorizationUrl: string } }).data
          .authorizationUrl,
      ),
      authorizationUrl: (started.body as { data: { authorizationUrl: string } })
        .data.authorizationUrl,
    };
  };

  /** Recorre el flujo completo: iniciar, autorizar y volver. */
  const connectGmail = async (code = 'codigo-bueno') => {
    const { nonceCookie, state } = await startFlow();

    await http()
      .get('/integrations/gmail/callback')
      .set('Cookie', [nonceCookie])
      .query({ state, code })
      .expect(302);

    const integrations = await as(tenant.owner, tenant)
      .get('/integrations')
      .expect(200);

    return (integrations.body as { data: { id: string }[] }).data[0];
  };

  /** Colección concedida SOLO al propietario: perímetro real, no nominal. */
  const createRestrictedCollection = async () => {
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: tenant.organizationId, name: 'Correo de ventas' },
    });
    await as(tenant.owner, tenant)
      .post(`/knowledge-collections/${collection.id}/access`)
      .send({ userId: tenant.owner.userId })
      .expect(201);

    return collection.id;
  };

  // Sin `async`: devuelve la petición de supertest para que cada test declare QUÉ código
  // espera, que es la mitad de lo que se está verificando.
  const createGmailSource = (params: {
    integrationId: string;
    collectionIds: string[];
    labelId?: string;
  }) =>
    as(tenant.owner, tenant)
      .post('/knowledge-sources')
      .send({
        name: 'Correo comercial',
        type: 'GMAIL',
        connectorKey: 'gmail_v1',
        integrationId: params.integrationId,
        config: {
          integrationId: params.integrationId,
          labelId: params.labelId ?? 'Label_ventas',
          labelName: 'Ventas',
        },
        knowledgeCollectionIds: params.collectionIds,
      });

  it('OBJETIVO DE CIERRE: conectar → colección → etiqueta → sincronizar → conocimiento', async () => {
    // 1. Conectar, autorizar y volver.
    const integration = await connectGmail();
    expect(integration.id).toBeTruthy();

    // 2. Elegir la etiqueta que actuará de frontera.
    const labels = await as(tenant.owner, tenant)
      .get(`/integrations/${integration.id}/labels`)
      .expect(200);
    const listed = (labels.body as { data: { id: string; name: string }[] })
      .data;
    expect(listed.map((label) => label.name)).toContain('Ventas');

    // 3. Fuente con colección RESTRINGIDA y etiqueta.
    const collectionId = await createRestrictedCollection();
    const created = await createGmailSource({
      integrationId: integration.id,
      collectionIds: [collectionId],
    }).expect(201);
    const sourceId = (created.body as { data: { id: string } }).data.id;

    // 4. Sincronizar.
    await as(tenant.owner, tenant)
      .post(`/knowledge-sources/${sourceId}/sync`)
      .expect(201);

    const items = await as(tenant.owner, tenant)
      .get('/knowledge-items')
      .expect(200);
    const knowledge = (items.body as { data: { title: string }[] }).data;
    expect(knowledge).toHaveLength(1);
    expect(knowledge[0].title).toContain('Ana García');
    // La dirección del remitente no viaja al cliente por ninguna vía.
    expect(JSON.stringify(items.body)).not.toContain('ana.garcia@empresa.com');

    // 5. Segunda sincronización sin cambios: CERO duplicados.
    await as(tenant.owner, tenant)
      .post(`/knowledge-sources/${sourceId}/sync`)
      .expect(201);
    expect(
      await prisma.knowledgeItem.count({
        where: { organizationId: tenant.organizationId },
      }),
    ).toBe(1);

    // Y la segunda vez se preguntó a Gmail solo por lo posterior al marcador.
    expect(gmail.calls.listMessages.at(-1)?.historyId).toBeDefined();
  });

  describe('CRÍTICO: sin perímetro restringido, la fuente no se crea', () => {
    it('sin colección, 400', async () => {
      const integration = await connectGmail();

      const response = await createGmailSource({
        integrationId: integration.id,
        collectionIds: [],
      }).expect(400);

      // Y el mensaje dice QUÉ hacer, no solo que falló.
      expect(JSON.stringify(response.body)).toMatch(/restringido/i);
    });

    it('con una colección abierta a toda la organización, 400', async () => {
      const integration = await connectGmail();
      const abierta = await prisma.knowledgeCollection.create({
        data: { organizationId: tenant.organizationId, name: 'General' },
      });
      for (const userId of [tenant.owner.userId, otroMiembro.userId]) {
        await as(tenant.owner, tenant)
          .post(`/knowledge-collections/${abierta.id}/access`)
          .send({ userId })
          .expect(201);
      }

      await createGmailSource({
        integrationId: integration.id,
        collectionIds: [abierta.id],
      }).expect(400);

      expect(
        await prisma.knowledgeSource.count({
          where: {
            organizationId: tenant.organizationId,
            connectorKey: 'gmail_v1',
          },
        }),
      ).toBe(0);
    });
  });

  describe('CRÍTICO: el callback no se puede provocar desde fuera', () => {
    it('sin la cookie del navegador que inició el flujo, RECHAZA', async () => {
      const { state } = await startFlow();

      // Es el ataque: un tercero provoca la vuelta con SU código para dejar la organización
      // de la víctima leyendo SU buzón.
      const response = await http()
        .get('/integrations/gmail/callback')
        .query({ state, code: 'codigo-del-atacante' })
        .expect(302);

      expect(response.headers.location).toMatch(/google=error/);
      expect(
        await prisma.integration.count({
          where: { organizationId: tenant.organizationId },
        }),
      ).toBe(0);
    });

    it('con una cookie que no corresponde, RECHAZA', async () => {
      const { state } = await startFlow();

      const response = await http()
        .get('/integrations/gmail/callback')
        .set('Cookie', ['bb_oauth_nonce=nonce-inventado'])
        .query({ state, code: 'x' })
        .expect(302);

      expect(response.headers.location).toMatch(/google=error/);
    });

    it('con un estado FABRICADO, RECHAZA', async () => {
      const response = await http()
        .get('/integrations/gmail/callback')
        .set('Cookie', ['bb_oauth_nonce=cualquiera'])
        .query({ state: 'no-es-un-estado-firmado', code: 'x' })
        .expect(302);

      expect(response.headers.location).toMatch(/google=error/);
    });

    it('un estado legítimo de DRIVE no conecta un buzón', async () => {
      // Mismo secreto de firma y misma cookie de nonce. Sin atar el estado al proveedor, un
      // flujo de Drive daría por conectado un BUZÓN, que es una superficie distinta.
      const { nonceCookie, state } = await startFlow('google-drive');

      const response = await http()
        .get('/integrations/gmail/callback')
        .set('Cookie', [nonceCookie])
        .query({ state, code: 'codigo-bueno' })
        .expect(302);

      expect(response.headers.location).toMatch(/google=error/);
      expect(
        await prisma.integration.count({
          where: { organizationId: tenant.organizationId },
        }),
      ).toBe(0);
    });

    it('RECHAZA un consentimiento sin el permiso de Gmail', async () => {
      const { nonceCookie, state } = await startFlow();

      const response = await http()
        .get('/integrations/gmail/callback')
        .set('Cookie', [nonceCookie])
        .query({ state, code: 'codigo-sin-permisos' })
        .expect(302);

      expect(response.headers.location).toMatch(/google=error/);
      expect(
        await prisma.integration.count({
          where: { organizationId: tenant.organizationId },
        }),
      ).toBe(0);
    });

    it('si la persona cancela, se dice y no se conecta nada', async () => {
      const response = await http()
        .get('/integrations/gmail/callback')
        .query({ error: 'access_denied' })
        .expect(302);

      expect(response.headers.location).toMatch(/google=cancelado/);
    });
  });

  describe('las credenciales de Google no salen nunca', () => {
    it('ni la lista de conexiones ni las etiquetas llevan tokens', async () => {
      const integration = await connectGmail();

      const listado = await as(tenant.owner, tenant)
        .get('/integrations')
        .expect(200);
      expect(JSON.stringify(listado.body)).not.toMatch(/token/i);
      expect(JSON.stringify(listado.body)).not.toMatch(/acceso-|refresco-/);

      const labels = await as(tenant.owner, tenant)
        .get(`/integrations/${integration.id}/labels`)
        .expect(200);
      expect(JSON.stringify(labels.body)).not.toMatch(/acceso-|refresco-/);
    });

    it('el estado que viaja por la URL no lleva el nonce en claro', async () => {
      // El estado queda en historiales, registros de proxy y cabeceras `Referer`. Por ahí
      // viaja solo el HASH del nonce; el nonce en claro existe únicamente en la cookie.
      const { state, nonceCookie } = await startFlow();
      const nonce = nonceCookie.split(';')[0].split('=')[1];

      expect(nonce).toBeTruthy();
      expect(state).not.toContain(nonce);
    });
  });

  describe('quién puede conectar', () => {
    it('un MEMBER no puede conectar, listar etiquetas ni desconectar', async () => {
      const integration = await connectGmail();

      // Conceder acceso de lectura al correo de la empresa está al nivel de conceder
      // capacidades a un agente, no al de guardar una preferencia.
      await as(otroMiembro, tenant)
        .get('/integrations/gmail/connect')
        .expect(403);
      await as(otroMiembro, tenant)
        .get(`/integrations/${integration.id}/labels`)
        .expect(403);
      await as(otroMiembro, tenant)
        .delete(`/integrations/${integration.id}`)
        .expect(403);
    });

    it('otra organización no ve ni usa la conexión', async () => {
      const integration = await connectGmail();
      const rival = await createTenant('gmail-rival');

      await as(rival.owner, rival)
        .get(`/integrations/${integration.id}/labels`)
        .expect(404);
      await as(rival.owner, rival)
        .delete(`/integrations/${integration.id}`)
        .expect(404);

      await destroyTenant(rival);
    });

    it('sin sesión no se llega a ninguna ruta', async () => {
      await http().get('/integrations/gmail/connect').expect(401);
    });
  });

  it('CRÍTICO: quien no tiene la colección no ve el correo indexado', async () => {
    const integration = await connectGmail();
    const collectionId = await createRestrictedCollection();
    const created = await createGmailSource({
      integrationId: integration.id,
      collectionIds: [collectionId],
    }).expect(201);
    const sourceId = (created.body as { data: { id: string } }).data.id;

    await as(tenant.owner, tenant)
      .post(`/knowledge-sources/${sourceId}/sync`)
      .expect(201);

    // El propietario, que tiene la colección concedida, lo ve.
    const suyos = await as(tenant.owner, tenant)
      .get('/knowledge-items')
      .expect(200);
    expect((suyos.body as { data: unknown[] }).data).toHaveLength(1);

    // El otro miembro de la MISMA organización, no. Es el escenario que motiva la fase:
    // conectar un buzón no convierte el correo de una persona en conocimiento de empresa.
    const ajenos = await as(otroMiembro, tenant)
      .get('/knowledge-items')
      .expect(200);
    expect(JSON.stringify(ajenos.body)).not.toContain('margen objetivo');
  });

  it('CRÍTICO: desconectar impide nuevas sincronizaciones', async () => {
    const integration = await connectGmail();
    const collectionId = await createRestrictedCollection();
    const created = await createGmailSource({
      integrationId: integration.id,
      collectionIds: [collectionId],
    }).expect(201);
    const sourceId = (created.body as { data: { id: string } }).data.id;
    await as(tenant.owner, tenant)
      .post(`/knowledge-sources/${sourceId}/sync`)
      .expect(201);

    await as(tenant.owner, tenant)
      .delete(`/integrations/${integration.id}`)
      .expect(200);

    await as(tenant.owner, tenant)
      .post(`/knowledge-sources/${sourceId}/sync`)
      .expect(400);

    // Y lo ya ingerido sobrevive: lo que se detiene es traer más.
    expect(
      await prisma.knowledgeItem.count({
        where: { organizationId: tenant.organizationId },
      }),
    ).toBe(1);
  });
});

import { MembershipRole } from '@businessbrain/database';
import { GOOGLE_DRIVE_PORT } from '../../src/integrations/domain/ports/google-drive.port';
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
 * Google Drive por HTTP, con el proveedor sustituido.
 *
 * Atraviesa la aplicación REAL —guards, firma del estado, cookies, controladores,
 * persistencia— y sustituye únicamente lo que es de Google. Es lo que permite verificar en CI
 * el flujo de conexión sin una cuenta real ni red.
 *
 * El callback de OAuth es la superficie más expuesta del sistema: llega por GET, desde el
 * navegador, sin cabecera `Authorization`. Buena parte de esta suite está escrita desde el
 * lado del atacante.
 */
describe('Google Drive (E2E)', () => {
  let tenant: TestTenant;
  const drive = new FakeGoogleDrive();
  const extraUsers: string[] = [];

  const POLITICA =
    'Los descuentos comerciales aplicados superan de forma recurrente el margen objetivo ' +
    'declarado por la compañía para el ejercicio en curso. La dirección revisa cada ' +
    'trimestre los umbrales aplicables por segmento de cliente.';

  beforeAll(async () => {
    await startTestApp([{ token: GOOGLE_DRIVE_PORT, value: drive }]);
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    tenant = await createTenant('drive');
    drive.revoked = [];
    drive.refreshShouldFail = false;
    drive.calls.listFiles.length = 0;
    drive.putFile({
      id: 'doc-1',
      name: 'Política de descuentos',
      text: POLITICA,
      modifiedTime: '2026-08-01T10:00:00.000Z',
    });
  });

  afterEach(async () => {
    await destroyTenant(tenant, extraUsers.splice(0));
  });

  /** Extrae una cookie de las cabeceras `Set-Cookie`. */
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

  /** Recorre el flujo completo: iniciar, autorizar y volver. */
  const connectDrive = async (code = 'codigo-bueno') => {
    const started = await as(tenant.owner, tenant)
      .get('/integrations/google-drive/connect')
      .expect(200);

    const nonceCookie = cookieFrom(started.headers, 'bb_oauth_nonce')!;
    const state = stateFrom(
      (started.body as { data: { authorizationUrl: string } }).data
        .authorizationUrl,
    );

    await http()
      .get('/integrations/google-drive/callback')
      .set('Cookie', [nonceCookie])
      .query({ state, code })
      .expect(302);

    const integrations = await as(tenant.owner, tenant)
      .get('/integrations')
      .expect(200);

    return (integrations.body as { data: { id: string }[] }).data[0];
  };

  const createDriveSource = async (integrationId: string) => {
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: tenant.organizationId, name: 'Drive' },
    });
    await as(tenant.owner, tenant)
      .post(`/knowledge-collections/${collection.id}/access`)
      .send({ userId: tenant.owner.userId })
      .expect(201);

    const created = await as(tenant.owner, tenant)
      .post('/knowledge-sources')
      .send({
        name: 'Carpeta de políticas',
        type: 'GOOGLE_DRIVE',
        connectorKey: 'google_drive_v1',
        integrationId,
        config: { integrationId, folderId: 'folder-1' },
        knowledgeCollectionIds: [collection.id],
      })
      .expect(201);

    return (created.body as { data: { id: string } }).data.id;
  };

  it('OBJETIVO DE CIERRE: conectar → carpeta → sincronizar → conocimiento visible', async () => {
    // 1. Conectar, autorizar y volver.
    const integration = await connectDrive();
    expect(integration.id).toBeTruthy();

    // 2. Elegir carpeta.
    const folders = await as(tenant.owner, tenant)
      .get(`/integrations/${integration.id}/folders`)
      .expect(200);
    expect((folders.body as { data: { name: string }[] }).data[0].name).toBe(
      'Políticas',
    );

    // 3. Fuente con colección.
    const sourceId = await createDriveSource(integration.id);

    // 4. Sincronizar.
    await as(tenant.owner, tenant)
      .post(`/knowledge-sources/${sourceId}/sync`)
      .expect(201);

    const items = await as(tenant.owner, tenant)
      .get('/knowledge-items')
      .expect(200);
    const list = (items.body as { data: { title: string }[] }).data;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Política de descuentos');

    // 5. Segunda sincronización sin cambios: CERO duplicados.
    await as(tenant.owner, tenant)
      .post(`/knowledge-sources/${sourceId}/sync`)
      .expect(201);
    expect(
      await prisma.knowledgeItem.count({
        where: { organizationId: tenant.organizationId },
      }),
    ).toBe(1);

    // Y la segunda vez se preguntó a Google solo por lo posterior al marcador.
    expect(drive.calls.listFiles.at(-1)?.cursor).toBe(
      '2026-08-01T10:00:00.000Z',
    );
  });

  it('un documento modificado produce una VERSIÓN, no una sobrescritura', async () => {
    const integration = await connectDrive();
    const sourceId = await createDriveSource(integration.id);
    await as(tenant.owner, tenant)
      .post(`/knowledge-sources/${sourceId}/sync`)
      .expect(201);

    drive.putFile({
      id: 'doc-1',
      name: 'Política de descuentos',
      text: `${POLITICA} Revisado en agosto.`,
      modifiedTime: '2026-08-20T10:00:00.000Z',
    });

    await as(tenant.owner, tenant)
      .post(`/knowledge-sources/${sourceId}/sync`)
      .expect(201);

    // La versión anterior sigue existiendo y el linaje lo declara.
    expect(
      await prisma.knowledgeItem.count({
        where: { organizationId: tenant.organizationId },
      }),
    ).toBe(2);
    expect(
      await prisma.knowledgeItemLineageEdge.count({
        where: { organizationId: tenant.organizationId, type: 'UPDATES' },
      }),
    ).toBe(1);
  });

  describe('CRÍTICO: el callback no se puede provocar desde fuera', () => {
    it('sin la cookie del navegador que inició el flujo, RECHAZA', async () => {
      const started = await as(tenant.owner, tenant)
        .get('/integrations/google-drive/connect')
        .expect(200);
      const state = stateFrom(
        (started.body as { data: { authorizationUrl: string } }).data
          .authorizationUrl,
      );

      // Es el ataque: un tercero provoca la vuelta con SU código para dejar la organización
      // de la víctima leyendo SU Drive.
      const response = await http()
        .get('/integrations/google-drive/callback')
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
      const started = await as(tenant.owner, tenant)
        .get('/integrations/google-drive/connect')
        .expect(200);
      const state = stateFrom(
        (started.body as { data: { authorizationUrl: string } }).data
          .authorizationUrl,
      );

      const response = await http()
        .get('/integrations/google-drive/callback')
        .set('Cookie', ['bb_oauth_nonce=nonce-inventado'])
        .query({ state, code: 'x' })
        .expect(302);

      expect(response.headers.location).toMatch(/google=error/);
    });

    it('con un estado FABRICADO, RECHAZA', async () => {
      // Sin la firma no se puede decir a qué organización conectar.
      const response = await http()
        .get('/integrations/google-drive/callback')
        .set('Cookie', ['bb_oauth_nonce=cualquiera'])
        .query({ state: 'no-es-un-estado-firmado', code: 'x' })
        .expect(302);

      expect(response.headers.location).toMatch(/google=error/);
    });

    it('sin código no conecta nada', async () => {
      const response = await http()
        .get('/integrations/google-drive/callback')
        .query({ state: 'x' })
        .expect(302);

      expect(response.headers.location).toMatch(/google=error/);
    });

    it('si la persona cancela, se dice y no se conecta nada', async () => {
      const response = await http()
        .get('/integrations/google-drive/callback')
        .query({ error: 'access_denied' })
        .expect(302);

      expect(response.headers.location).toMatch(/google=cancelado/);
    });
  });

  describe('los tokens de Google no salen nunca', () => {
    it('la lista de conexiones no contiene ningún token', async () => {
      await connectDrive();

      const response = await as(tenant.owner, tenant)
        .get('/integrations')
        .expect(200);

      // Devolver el de refresco sería entregar acceso permanente al Drive de la empresa a
      // cualquier script de la página.
      expect(JSON.stringify(response.body)).not.toMatch(/token/i);
      expect(JSON.stringify(response.body)).not.toMatch(/acceso-|refresco-/);
    });
  });

  describe('quién puede conectar', () => {
    it('un MEMBER no puede conectar ni desconectar', async () => {
      const integration = await connectDrive();
      const member: TestActor = await addMember(tenant, MembershipRole.MEMBER);
      extraUsers.push(member.userId);

      // Conceder acceso de lectura al Drive de la empresa está al nivel de conceder
      // capacidades a un agente.
      await as(member, tenant)
        .get('/integrations/google-drive/connect')
        .expect(403);
      await as(member, tenant)
        .delete(`/integrations/${integration.id}`)
        .expect(403);
    });

    it('otra organización no ve ni usa la conexión', async () => {
      const integration = await connectDrive();
      const rival = await createTenant('drive-rival');

      await as(rival.owner, rival)
        .get(`/integrations/${integration.id}/folders`)
        .expect(404);
      await as(rival.owner, rival)
        .delete(`/integrations/${integration.id}`)
        .expect(404);

      await destroyTenant(rival);
    });

    it('sin sesión no se llega a ninguna ruta', async () => {
      await http().get('/integrations').expect(401);
      await http().get('/integrations/google-drive/connect').expect(401);
    });
  });

  it('CRÍTICO: desconectar impide nuevas sincronizaciones', async () => {
    const integration = await connectDrive();
    const sourceId = await createDriveSource(integration.id);
    await as(tenant.owner, tenant)
      .post(`/knowledge-sources/${sourceId}/sync`)
      .expect(201);

    await as(tenant.owner, tenant)
      .delete(`/integrations/${integration.id}`)
      .expect(200);

    // Se le dijo a Google, no solo a nuestra base de datos.
    expect(drive.revoked.length).toBeGreaterThan(0);

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

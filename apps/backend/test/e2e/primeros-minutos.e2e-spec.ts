import { MembershipRole } from '@businessbrain/database';
import {
  addMember,
  as,
  createTenant,
  destroyTenant,
  http,
  llmScript,
  startTestApp,
  stopTestApp,
  type TestActor,
  type TestTenant,
} from './harness';

/**
 * Los primeros minutos de una PYME, sin sembrar nada en la base de datos.
 *
 * ## Qué verifica esta suite que ninguna otra verificaba
 *
 * Las demás suites siembran conocimiento, colecciones y comprensión directamente con Prisma para
 * poder centrarse en la garantía que les toca. Eso deja un hueco enorme: **una capacidad puede
 * funcionar con datos sembrados y ser inalcanzable para una persona real**. Aquí no se siembra
 * nada — cada paso es la petición que haría la interfaz, en el orden en que la haría, empezando
 * por registrarse sin pertenecer a ninguna organización.
 *
 * Es la suite que detecta que el producto no se puede empezar a usar, no que un módulo esté mal.
 */
describe('Los primeros minutos de una PYME (E2E)', () => {
  let tenant: TestTenant;
  const extraUsers: string[] = [];

  /** Documento con cuerpo: por debajo del umbral no hay conocimiento que recuperar. */
  const POLITICA =
    'La política de descuentos comerciales de la empresa fija un máximo del quince por ciento ' +
    'para el canal mayorista. Cualquier descuento superior exige autorización expresa del ' +
    'responsable de área, registrada por escrito antes de trasladar la oferta al cliente.';

  beforeAll(async () => {
    await startTestApp();
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(() => {
    llmScript.answers = [];
  });

  afterEach(async () => {
    if (tenant) await destroyTenant(tenant, extraUsers.splice(0));
  });

  /**
   * Sube un documento por la MISMA vía que la interfaz: `multipart/form-data`.
   *
   * No se escribe el `KnowledgeItem` a mano a propósito: subir un fichero es el primer gesto
   * real de una PYME, y si esa ruta se rompiera, sembrar el ítem lo ocultaría.
   */
  const uploadDocument = (
    actor: TestActor,
    sourceId: string,
    text: string,
    filename = 'politica-descuentos.txt',
  ) =>
    http()
      .post(`/knowledge-sources/${sourceId}/sync`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('x-org-id', tenant.organizationId)
      .attach('file', Buffer.from(text, 'utf8'), filename);

  it('CRITERIO DE CIERRE: de registrarse a una respuesta con fuentes, sin sembrar nada', async () => {
    // ── 1. Registrarse. Todavía no pertenece a ninguna empresa ────────────────
    const email = `pyme-${Date.now()}@test.local`;
    const password = 'contrasena-de-prueba';

    await http()
      .post('/auth/register')
      .send({ email, password, name: 'Dueña de la PYME' })
      .expect(201);
    const login = await http()
      .post('/auth/login')
      .send({ email, password })
      .expect(201);

    const owner: TestActor = {
      userId: login.body.data.user.id,
      email,
      password,
      accessToken: login.body.data.accessToken,
    };

    // Sin organización, la sesión existe pero no hay producto: es exactamente el punto en el
    // que la interfaz remitía a la API.
    const me = await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(me.body.data.memberships).toHaveLength(0);

    // ── 2. Crear la empresa: DEBE poder hacerse por la misma vía que la UI ────
    const created = await http()
      .post('/organizations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: `Panadería ${Date.now()}` })
      .expect(201);

    tenant = { organizationId: created.body.data.id, owner };

    // Y quien la crea queda dentro con mando: si no, no podría ni conectar una fuente.
    const afterCreating = await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(afterCreating.body.data.memberships).toEqual([
      expect.objectContaining({
        organizationId: tenant.organizationId,
        role: MembershipRole.OWNER,
      }),
    ]);

    // ── 3. Colección y fuente ────────────────────────────────────────────────
    const collection = await as(owner, tenant)
      .post('/knowledge-collections')
      .send({ name: 'Comercial' })
      .expect(201);
    const collectionId = collection.body.data.id;

    const source = await as(owner, tenant)
      .post('/knowledge-sources')
      .send({
        name: 'Mis documentos',
        type: 'FILE_UPLOAD',
        connectorKey: 'file_upload_v1',
        knowledgeCollectionIds: [collectionId],
      })
      .expect(201);

    // ── 4. Subir un documento de verdad ──────────────────────────────────────
    await uploadDocument(owner, source.body.data.id, POLITICA).expect(201);

    const items = await as(owner, tenant).get('/knowledge-items').expect(200);
    expect(items.body.data).toHaveLength(1);
    expect(items.body.data[0].status).toBe('INDEXED');

    // ── 5. PREGUNTAR: es el paso que no existía en la interfaz ───────────────
    llmScript.answers = [
      'El máximo es del quince por ciento en el canal mayorista [1].',
    ];

    const conversation = await as(owner, tenant)
      .post('/conversations')
      .send({ title: '¿Cuál es nuestro descuento máximo?' })
      .expect(201);

    const answer = await as(owner, tenant)
      .post(`/conversations/${conversation.body.data.id}/messages`)
      .send({ content: '¿Cuál es nuestro descuento máximo?' })
      .expect(201);

    expect(answer.body.data.content).toContain('quince por ciento');
    // Con fuentes: una respuesta sin citas es indistinguible de una invención, y no vale para
    // tomar ninguna decisión en una empresa.
    expect(answer.body.data.citations.length).toBeGreaterThan(0);
    expect(answer.body.data.citations[0].knowledgeItemId).toBe(
      items.body.data[0].id,
    );

    // ── 6. Y queda escrito, para poder volver a leerlo ───────────────────────
    const thread = await as(owner, tenant)
      .get(`/conversations/${conversation.body.data.id}`)
      .expect(200);
    expect(thread.body.data.messages).toHaveLength(2);
    expect(thread.body.data.messages[1].citations).not.toBeNull();
  });

  describe('CRÍTICO: cada persona pregunta dentro de SU alcance', () => {
    it('quien no tiene la colección concedida no recibe el contenido ajeno', async () => {
      tenant = await createTenant('alcance');

      const collection = await as(tenant.owner, tenant)
        .post('/knowledge-collections')
        .send({ name: 'Dirección' })
        .expect(201);
      const source = await as(tenant.owner, tenant)
        .post('/knowledge-sources')
        .send({
          name: 'Documentos de dirección',
          type: 'FILE_UPLOAD',
          connectorKey: 'file_upload_v1',
          knowledgeCollectionIds: [collection.body.data.id],
        })
        .expect(201);
      await uploadDocument(tenant.owner, source.body.data.id, POLITICA).expect(
        201,
      );

      // Alguien más de la MISMA empresa, sin esa colección concedida.
      const colega: TestActor = await addMember(
        tenant,
        MembershipRole.MEMBER,
        'colega',
      );
      extraUsers.push(colega.userId);

      llmScript.answers = ['Da igual lo que diga el modelo.'];
      const conversation = await as(colega, tenant)
        .post('/conversations')
        .send({ title: 'Curioseando' })
        .expect(201);
      const answer = await as(colega, tenant)
        .post(`/conversations/${conversation.body.data.id}/messages`)
        .send({ content: '¿Cuál es nuestro descuento máximo?' })
        .expect(201);

      // Sin alcance no hay material, y sin material NO se inventa una respuesta: se dice que
      // no se sabe. Y sobre todo, ni una cita al documento ajeno.
      expect(answer.body.data.citations).toHaveLength(0);
      expect(answer.body.data.content).not.toContain('quince por ciento');
      // Tampoco por la puerta de al lado: la lista de documentos está igual de acotada.
      const suyos = await as(colega, tenant)
        .get('/knowledge-items')
        .expect(200);
      expect(suyos.body.data).toHaveLength(0);
    });

    it('otra empresa no ve ni alcanza la conversación', async () => {
      tenant = await createTenant('propia');
      const rival = await createTenant('rival');

      const conversation = await as(tenant.owner, tenant)
        .post('/conversations')
        .send({ title: 'Privada' })
        .expect(201);

      await as(rival.owner, rival)
        .get(`/conversations/${conversation.body.data.id}`)
        .expect(404);
      await as(rival.owner, rival)
        .post(`/conversations/${conversation.body.data.id}/messages`)
        .send({ content: 'hola' })
        .expect(404);

      await destroyTenant(rival);
    });

    it('la conversación es de quien la abrió, no de la organización', async () => {
      tenant = await createTenant('privacidad');
      const colega: TestActor = await addMember(
        tenant,
        MembershipRole.ADMIN,
        'admin',
      );
      extraUsers.push(colega.userId);

      const mia = await as(tenant.owner, tenant)
        .post('/conversations')
        .send({ title: 'Lo que yo pregunto' })
        .expect(201);

      // Ni siquiera un ADMIN lee lo que preguntó otra persona: preguntar es un acto privado, y
      // el historial de preguntas de alguien dice más de él que el propio conocimiento.
      await as(colega, tenant)
        .get(`/conversations/${mia.body.data.id}`)
        .expect(404);
      const suyas = await as(colega, tenant).get('/conversations').expect(200);
      expect(suyas.body.data).toHaveLength(0);
    });
  });

  describe('invitar a alguien funciona de punta a punta', () => {
    it('el invitado entra en la empresa con el rol declarado', async () => {
      tenant = await createTenant('equipo');

      const invitado = `invitado-${Date.now()}@test.local`;
      const invitation = await as(tenant.owner, tenant)
        .post(`/organizations/${tenant.organizationId}/invitations`)
        .send({ email: invitado, role: MembershipRole.VIEWER })
        .expect(201);

      // El token viaja en la respuesta: es el enlace que la interfaz muestra para copiar,
      // porque BusinessBrain todavía no envía correo.
      const token = invitation.body.data.token;
      expect(typeof token).toBe('string');

      await http()
        .post('/auth/register')
        .send({
          email: invitado,
          password: 'contrasena-de-prueba',
          name: 'Invitado',
        })
        .expect(201);
      const login = await http()
        .post('/auth/login')
        .send({ email: invitado, password: 'contrasena-de-prueba' })
        .expect(201);
      extraUsers.push(login.body.data.user.id);

      await http()
        .post(`/invitations/${token}/accept`)
        .set('Authorization', `Bearer ${login.body.data.accessToken}`)
        .expect(201);

      const members = await as(tenant.owner, tenant)
        .get(`/organizations/${tenant.organizationId}/members`)
        .expect(200);
      expect(members.body.data).toHaveLength(2);
      expect(
        members.body.data.find(
          (member: { user: { email: string }; role: string }) =>
            member.user.email === invitado,
        ).role,
      ).toBe(MembershipRole.VIEWER);
    });

    it('CRÍTICO: el enlace no sirve a quien no fue invitado', async () => {
      tenant = await createTenant('equipo-seguro');

      const invitation = await as(tenant.owner, tenant)
        .post(`/organizations/${tenant.organizationId}/invitations`)
        .send({ email: `destinataria-${Date.now()}@test.local` })
        .expect(201);

      // Reenviar el enlace a un tercero no le da acceso: el correo debe coincidir. Es lo que
      // hace que un enlace copiado y pegado siga siendo seguro.
      const otro: TestActor = await addMember(
        await createTenant('otra-empresa'),
        MembershipRole.MEMBER,
        'ajeno',
      );
      extraUsers.push(otro.userId);

      await http()
        .post(`/invitations/${invitation.body.data.token}/accept`)
        .set('Authorization', `Bearer ${otro.accessToken}`)
        .expect(403);

      const members = await as(tenant.owner, tenant)
        .get(`/organizations/${tenant.organizationId}/members`)
        .expect(200);
      expect(members.body.data).toHaveLength(1);
    });

    it('un MEMBER no puede invitar', async () => {
      tenant = await createTenant('permisos');
      const colega: TestActor = await addMember(
        tenant,
        MembershipRole.MEMBER,
        'miembro',
      );
      extraUsers.push(colega.userId);

      await as(colega, tenant)
        .post(`/organizations/${tenant.organizationId}/invitations`)
        .send({ email: 'alguien@test.local' })
        .expect(403);
    });
  });

  it('sin conocimiento NO se inventa una respuesta', async () => {
    // Es la garantía que sostiene todo lo demás: si respondiera de memoria del modelo, nada de
    // lo que dijera sería atribuible a la empresa y el producto no valdría para decidir.
    tenant = await createTenant('vacia');
    llmScript.answers = ['El descuento máximo es del cuarenta por ciento.'];

    const conversation = await as(tenant.owner, tenant)
      .post('/conversations')
      .send({ title: 'Sin nada' })
      .expect(201);
    const answer = await as(tenant.owner, tenant)
      .post(`/conversations/${conversation.body.data.id}/messages`)
      .send({ content: '¿Cuál es nuestro descuento máximo?' })
      .expect(201);

    expect(answer.body.data.citations).toHaveLength(0);
    expect(answer.body.data.content).not.toContain('cuarenta');
  });
});

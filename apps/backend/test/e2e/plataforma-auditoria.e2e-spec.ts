import {
  as,
  createTenant,
  destroyTenant,
  http,
  prisma,
  reauthenticate,
  registerPlatformAdmin,
  startTestApp,
  stopTestApp,
  type TestActor,
  type TestTenant,
} from './harness';

/**
 * Qué auditoría puede leer quien administra BusinessBrain (E2E).
 *
 * ## Las dos mitades de esta suite
 *
 * Lo que SÍ puede consultar —sus propias acciones, con quién, qué, sobre qué empresa y
 * cuándo— y, con el mismo peso, **lo que no**. La segunda mitad es la que importa: si la
 * auditoría de los clientes se colara aquí, no haría falta leer los documentos de una empresa
 * para saber de qué habla su negocio. Bastaría con leer lo que hace su gente.
 *
 * ## Y el caso que un filtro ingenuo habría dejado pasar
 *
 * El borrado de datos de una empresa se registra **sin organización**, para sobrevivir a la
 * cascada. Pero lo hace el propietario de esa empresa, no la plataforma. Cualquier filtro
 * basado en "no tiene organización" se lo habría enseñado al administrador — y por eso el
 * filtro es una lista cerrada de acciones. Hay una prueba dedicada a ese caso.
 */
describe('Auditoría de plataforma (E2E)', () => {
  let admin: TestActor;
  let tenant: TestTenant;
  const extranos: string[] = [];

  beforeAll(async () => {
    await startTestApp();
    admin = await registerPlatformAdmin('auditoria');
    tenant = await createTenant('auditoria-cliente');
  });

  /**
   * El administrador confirma quién es antes de cada prueba.
   *
   * Banear y cambiar de plan son acciones sensibles desde la Fase 4, y esta suite las usa para
   * GENERAR las entradas que luego lee. Que el guard esté puesto de verdad lo comprueba
   * `plataforma-mfa.e2e-spec.ts`; aquí lo que se verifica es qué queda registrado y quién
   * puede verlo.
   */
  beforeEach(async () => {
    await reauthenticate(admin);
  });

  afterAll(async () => {
    await destroyTenant(tenant, [admin.userId, ...extranos]);
    await stopTestApp();
  });

  const comoAdmin = () => ({
    get: (url: string) =>
      http().get(url).set('Authorization', `Bearer ${admin.accessToken}`),
    post: (url: string) =>
      http().post(url).set('Authorization', `Bearer ${admin.accessToken}`),
  });

  interface Entrada {
    id: string;
    at: string;
    code: string;
    actor: { id: string; name: string } | null;
    organization: { id: string; name: string | null } | null;
    target: { type: string | null; id: string | null };
    details: Record<string, unknown>;
  }

  const leerAuditoria = async (query = ''): Promise<Entrada[]> => {
    const respuesta = await comoAdmin()
      .get(`/platform/audit${query}`)
      .expect(200);
    return (respuesta.body as { data: { items: Entrada[] } }).data.items;
  };

  describe('la puerta', () => {
    it('CRÍTICO: sin sesión no se lee', async () => {
      await http().get('/platform/audit').expect(401);
      await http().get('/platform/audit/actions').expect(401);
    });

    it('CRÍTICO: un cliente no lee la auditoría de plataforma, ni siendo OWNER', async () => {
      await as(tenant.owner, tenant).get('/platform/audit').expect(403);
      await as(tenant.owner, tenant).get('/platform/audit/actions').expect(403);
    });
  });

  describe('lo que el administrador SÍ ve', () => {
    it('sus propias acciones, con las cinco respuestas', async () => {
      // Quién, qué, sobre qué empresa, cuándo y qué dejó. Una traza que no responda a las
      // cinco no sirve para investigar nada.
      await comoAdmin()
        .post(`/platform/organizations/${tenant.organizationId}/plan`)
        .send({ planTier: 'PRO' })
        .expect(201);

      const entradas = await leerAuditoria();
      const cambio = entradas.find(
        (entrada) =>
          entrada.code === 'platform.organization.plan_changed' &&
          entrada.organization?.id === tenant.organizationId,
      );

      expect(cambio).toBeDefined();
      expect(cambio?.actor?.id).toBe(admin.userId);
      expect(cambio?.actor?.name).toBeTruthy();
      expect(cambio?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(cambio?.target.type).toBe('Organization');
      expect(cambio?.details).toMatchObject({ from: 'FREE', to: 'PRO' });
    });

    it('la lectura de datos personales aparece como lo que es', async () => {
      await comoAdmin().get('/platform/users').expect(200);

      const entradas = await leerAuditoria();
      const lectura = entradas.find(
        (entrada) => entrada.code === 'platform.users.listed',
      );

      expect(lectura).toBeDefined();
      expect(lectura?.actor?.id).toBe(admin.userId);
      // El recuento, nunca quiénes.
      expect(lectura?.details).toHaveProperty('returned');
    });

    it('se puede filtrar por acción y por empresa', async () => {
      const soloPlanes = await leerAuditoria(
        '?code=platform.organization.plan_changed',
      );
      expect(soloPlanes.length).toBeGreaterThan(0);
      expect(
        soloPlanes.every(
          (entrada) => entrada.code === 'platform.organization.plan_changed',
        ),
      ).toBe(true);

      const deEsaEmpresa = await leerAuditoria(
        `?organizationId=${tenant.organizationId}`,
      );
      expect(deEsaEmpresa.length).toBeGreaterThan(0);
      expect(
        deEsaEmpresa.every(
          (entrada) => entrada.organization?.id === tenant.organizationId,
        ),
      ).toBe(true);
    });

    it('el catálogo de acciones consultables es solo de plataforma', async () => {
      const respuesta = await comoAdmin()
        .get('/platform/audit/actions')
        .expect(200);
      const acciones = (respuesta.body as { data: string[] }).data;

      expect(acciones.length).toBeGreaterThan(0);
      expect(acciones.every((accion) => accion.startsWith('platform.'))).toBe(
        true,
      );
    });
  });

  describe('lo que el administrador NO ve', () => {
    it('CRÍTICO: ninguna acción de un cliente aparece en el listado', async () => {
      // Se genera actividad real de tenant: crear una colección deja traza en la auditoría de
      // esa empresa. Es suya, y el administrador no tiene por qué verla.
      await as(tenant.owner, tenant)
        .post('/knowledge-collections')
        .send({ name: `Colección privada ${Date.now()}` })
        .expect(201);

      // Existe de verdad — si no, la prueba pasaría sin comprobar nada.
      await expect(
        prisma.auditLog.count({
          where: {
            organizationId: tenant.organizationId,
            action: 'knowledge_collection.created',
          },
        }),
      ).resolves.toBeGreaterThan(0);

      const entradas = await leerAuditoria();
      const ajenas = entradas.filter(
        (entrada) => !entrada.code.startsWith('platform.'),
      );

      expect(ajenas).toEqual([]);
    });

    it('CRÍTICO: el borrado de datos de una empresa NO aparece, aunque no cuelgue de ninguna', async () => {
      // Es la trampa: se registra con `organizationId: null` para sobrevivir a la cascada,
      // pero lo hace el PROPIETARIO de la empresa. Un filtro por "sin organización" se lo
      // habría enseñado al administrador.
      const efimera = await createTenant('auditoria-efimera');
      extranos.push(efimera.owner.userId);
      const empresa = await prisma.organization.findUniqueOrThrow({
        where: { id: efimera.organizationId },
      });

      await reauthenticate(efimera.owner);
      await as(efimera.owner, efimera)
        .post(`/organizations/${efimera.organizationId}/erase`)
        .send({ confirmationName: empresa.name })
        .expect(200);

      // La traza existe y NO cuelga de ninguna organización.
      const traza = await prisma.auditLog.findFirstOrThrow({
        where: {
          action: 'organization.data_erased',
          targetId: efimera.organizationId,
        },
      });
      expect(traza.organizationId).toBeNull();

      // Y aun así, el administrador no la ve.
      const entradas = await leerAuditoria();
      expect(
        entradas.some((entrada) => entrada.code === 'organization.data_erased'),
      ).toBe(false);
    });

    it('CRÍTICO: filtrar por una acción de cliente no devuelve nada', async () => {
      // Un código que no está en la lista cerrada no estrecha la consulta: la vacía. Pedir
      // `insight.curated` no puede devolver nada, ni siquiera por accidente.
      for (const ajena of [
        'knowledge_collection.created',
        'insight.curated',
        'organization.data_erased',
        'recommendation.accepted',
      ]) {
        await expect(leerAuditoria(`?code=${ajena}`)).resolves.toEqual([]);
      }
    });

    it('CRÍTICO: la respuesta no lleva correos, secretos ni contenido', async () => {
      await comoAdmin().get('/platform/users').expect(200);
      const respuesta = await comoAdmin().get('/platform/audit').expect(200);
      const cuerpo = JSON.stringify(respuesta.body);

      // Ni el correo del administrador ni el de nadie: para saber quién hizo algo basta el
      // nombre, y el correo es dato personal que aquí no aporta.
      expect(cuerpo).not.toContain('@');
      expect(cuerpo).not.toMatch(/apiKey|passwordHash|configEnc|token/i);
      expect(cuerpo).not.toContain('[REDACTADO]');
    });
  });

  describe('la traza sobrevive al cliente', () => {
    it('CRÍTICO: sigue siendo legible después de borrar la empresa', async () => {
      // Es justo entonces cuando hay que poder demostrar qué se le hizo. Y el nombre de la
      // empresa queda congelado en la traza: sin él, quedaría un identificador huérfano que
      // no le dice nada a nadie.
      const efimera = await createTenant('auditoria-borrada');
      extranos.push(efimera.owner.userId);
      const empresa = await prisma.organization.findUniqueOrThrow({
        where: { id: efimera.organizationId },
      });

      await comoAdmin()
        .post(`/platform/organizations/${efimera.organizationId}/plan`)
        .send({ planTier: 'ENTERPRISE' })
        .expect(201);

      await prisma.organization.delete({
        where: { id: efimera.organizationId },
      });

      const entradas = await leerAuditoria(
        `?organizationId=${efimera.organizationId}`,
      );

      expect(entradas).toHaveLength(1);
      expect(entradas[0].code).toBe('platform.organization.plan_changed');
      expect(entradas[0].organization?.name).toBe(empresa.name);
      expect(entradas[0].details).toMatchObject({ to: 'ENTERPRISE' });
    });
  });
});

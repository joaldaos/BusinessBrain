import {
  as,
  createTenant,
  destroyTenant,
  http,
  prisma,
  registerActor,
  registerPlatformAdmin,
  startTestApp,
  stopTestApp,
  type TestActor,
  type TestTenant,
} from './harness';

/**
 * La frontera entre quien OPERA BusinessBrain y quien lo USA (E2E).
 *
 * ## Por qué esto se prueba sobre HTTP y no en unitarias
 *
 * `SuperAdminGuard` existía desde la Fase 1 y **nunca se había ejercitado sobre HTTP**: había
 * pruebas del servicio, ninguna de la puerta. Un guard es código correcto que no sirve de nada
 * si la ruta no lo lleva puesto, y eso solo se ve llamando a la ruta. Ya pasó una vez con
 * `JwtAuthGuard`, y por eso existe esta suite entera.
 *
 * ## Y qué garantiza
 *
 * Que el administrador de plataforma es, para la API de cliente, exactamente igual que un
 * desconocido. No porque haya un `if` que lo compruebe, sino porque **no tiene membresías** y
 * `OrgRoleGuard` exige membresía. El aislamiento no depende de que nadie se olvide de nada.
 */
describe('Administración de plataforma y aislamiento (E2E)', () => {
  let admin: TestActor;
  let tenant: TestTenant;
  const extranos: string[] = [];

  beforeAll(async () => {
    await startTestApp();
    admin = await registerPlatformAdmin('aislamiento');
    tenant = await createTenant('aislamiento-cliente');
  });

  afterAll(async () => {
    await destroyTenant(tenant, [admin.userId, ...extranos]);
    await stopTestApp();
  });

  /** Petición como administrador de plataforma: sin cabecera de organización, no tiene. */
  const comoAdmin = () => ({
    get: (url: string) =>
      http().get(url).set('Authorization', `Bearer ${admin.accessToken}`),
    post: (url: string) =>
      http().post(url).set('Authorization', `Bearer ${admin.accessToken}`),
  });

  describe('la puerta de administración', () => {
    it('CRÍTICO: sin sesión no se entra', async () => {
      for (const ruta of [
        '/admin/stats',
        '/admin/organizations',
        '/admin/users',
      ]) {
        await http().get(ruta).expect(401);
      }
    });

    it('CRÍTICO: un usuario de cliente NO entra, aunque sea OWNER de su empresa', async () => {
      // Ser dueño de una empresa no es tener nada que ver con la administración de la
      // plataforma. Son dos ejes distintos y esta es la prueba de que no se cruzan.
      for (const ruta of [
        '/admin/stats',
        '/admin/organizations',
        '/admin/users',
      ]) {
        await as(tenant.owner, tenant).get(ruta).expect(403);
      }
      await as(tenant.owner, tenant)
        .post(`/admin/users/${tenant.owner.userId}/ban`)
        .expect(403);
    });

    it('el administrador de plataforma sí entra', async () => {
      await comoAdmin().get('/admin/stats').expect(200);
      await comoAdmin().get('/admin/organizations').expect(200);
      await comoAdmin().get('/admin/users').expect(200);
    });
  });

  describe('el administrador NO puede entrar en la API de cliente', () => {
    it('CRÍTICO: toda ruta de tenant le responde igual que a un desconocido', async () => {
      // No hay excepción de superadmin en `OrgRoleGuard`, y no debe haberla. Lo que le cierra
      // la puerta es no tener membresía, que es una condición que no se puede olvidar aplicar.
      const rutas = [
        '/knowledge-items',
        '/knowledge-sources',
        '/knowledge-collections',
        '/insights',
        '/conversations',
        '/recommendations',
        '/analysis-runs',
        '/reports',
        '/automations',
        '/business-objectives',
        '/ai-configuration',
        '/integrations',
      ];

      // Se recogen todas y se comparan de golpe: así el fallo dice QUÉ ruta dejó pasar, en
      // vez de parar en la primera y esconder las demás.
      const denegadas: Record<string, number> = {};
      for (const ruta of rutas) {
        const respuesta = await comoAdmin()
          .get(ruta)
          .set('x-org-id', tenant.organizationId);
        denegadas[ruta] = respuesta.status;
      }

      const abiertas = Object.entries(denegadas).filter(
        ([, status]) => status !== 403 && status !== 404,
      );
      expect(abiertas).toEqual([]);
    });

    it('CRÍTICO: tampoco puede exportar ni borrar los datos de un cliente', async () => {
      // Son las dos acciones más sensibles del producto, y las dos son del propietario de la
      // empresa. La plataforma no las hereda por ser plataforma.
      await comoAdmin()
        .get(`/organizations/${tenant.organizationId}/export`)
        .set('x-org-id', tenant.organizationId)
        .expect(403);

      await comoAdmin()
        .post(`/organizations/${tenant.organizationId}/erase`)
        .set('x-org-id', tenant.organizationId)
        .send({ confirmationName: 'lo que sea' })
        .expect(403);
    });

    it('CRÍTICO: no puede leer la organización de un cliente', async () => {
      await comoAdmin()
        .get(`/organizations/${tenant.organizationId}`)
        .expect(403);
    });
  });

  describe('la invariante: administrar y pertenecer son incompatibles', () => {
    it('CRÍTICO: un administrador de plataforma no puede crear una empresa', async () => {
      // Sería la vía evidente para saltarse todo lo anterior: crearse una organización y
      // entrar por la puerta normal como OWNER.
      const respuesta = await comoAdmin()
        .post('/organizations')
        .send({ name: 'Mi empresa de puerta trasera' })
        .expect(403);

      expect(JSON.stringify(respuesta.body)).toMatch(/cuenta distinta/i);
      await expect(
        prisma.membership.count({ where: { userId: admin.userId } }),
      ).resolves.toBe(0);
    });

    it('CRÍTICO: tampoco puede aceptar una invitación', async () => {
      // La otra vía: que alguien de dentro le invite. La frontera se cruza en los dos
      // sentidos y por eso se comprueba en los dos puntos donde nace una membresía.
      const invitacion = await as(tenant.owner, tenant)
        .post(`/organizations/${tenant.organizationId}/invitations`)
        .send({ email: admin.email, role: 'ADMIN' })
        .expect(201);

      const token = (invitacion.body as { data: { token: string } }).data.token;

      await comoAdmin().post(`/invitations/${token}/accept`).expect(403);
      await expect(
        prisma.membership.count({ where: { userId: admin.userId } }),
      ).resolves.toBe(0);
    });

    it('una cuenta normal sí puede hacer las dos cosas', async () => {
      // La invariante no puede haber roto el producto: quien no es plataforma entra igual.
      const persona = await registerActor('cuenta-normal');
      extranos.push(persona.userId);

      await http()
        .post('/organizations')
        .set('Authorization', `Bearer ${persona.accessToken}`)
        .send({ name: `Empresa normal ${Date.now()}` })
        .expect(201);
    });
  });

  describe('lo que la plataforma ve de sus clientes', () => {
    it('CRÍTICO: el listado de organizaciones no lleva su configuración', async () => {
      const respuesta = await comoAdmin()
        .get('/admin/organizations')
        .expect(200);

      const cuerpo = JSON.stringify(respuesta.body);
      expect(cuerpo).not.toContain('settings');
      expect(cuerpo).not.toContain('dailyCharacterLimit');
      expect(cuerpo).not.toContain('minimumFloor');
    });

    it('los recuentos sí: son la señal operativa', async () => {
      const respuesta = await comoAdmin()
        .get('/admin/organizations')
        .expect(200);

      const items = (
        respuesta.body as { data: { items: { _count?: unknown }[] } }
      ).data.items;
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]._count).toBeDefined();
    });

    it('CRÍTICO: leer la lista de personas deja rastro, sin copiar los correos', async () => {
      await comoAdmin().get('/admin/users').expect(200);

      const traza = await prisma.auditLog.findFirst({
        where: { action: 'platform.users.listed', actorId: admin.userId },
        orderBy: { createdAt: 'desc' },
      });

      expect(traza).not.toBeNull();
      // Una auditoría que copiara los correos sería un segundo almacén de los mismos datos
      // personales: el problema que intenta controlar, duplicado dentro de ella.
      expect(JSON.stringify(traza?.metadata)).not.toContain('@');
    });
  });

  describe('la traza de plataforma sobrevive al cliente', () => {
    it('CRÍTICO: borrar la organización no borra lo que la plataforma le hizo', async () => {
      // `AuditLog` cae en cascada con la organización. Si la acción se registrara con su
      // identificador, desaparecería justo cuando hay que poder demostrar qué se hizo.
      const efimera = await createTenant('plataforma-efimera');
      extranos.push(efimera.owner.userId);

      await comoAdmin()
        .post(`/admin/organizations/${efimera.organizationId}/plan`)
        .send({ planTier: 'PRO' })
        .expect(201);

      await prisma.organization.delete({
        where: { id: efimera.organizationId },
      });

      const traza = await prisma.auditLog.findFirst({
        where: {
          action: 'organization.plan_changed',
          targetId: efimera.organizationId,
        },
      });

      expect(traza).not.toBeNull();
      expect(traza?.organizationId).toBeNull();
      expect(traza?.metadata).toMatchObject({
        organizationId: efimera.organizationId,
        from: 'FREE',
        to: 'PRO',
      });
    });
  });
});

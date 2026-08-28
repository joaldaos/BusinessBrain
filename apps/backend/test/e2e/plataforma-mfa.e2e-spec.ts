import {
  as,
  codeFor,
  createTenant,
  destroyTenant,
  enableMfa,
  expireReauthentication,
  prisma,
  reauthenticate,
  registerPlatformAdmin,
  registerPlatformAdminWithoutMfa,
  startTestApp,
  stopTestApp,
  type TestActor,
  type TestTenant,
} from './harness';

/**
 * La administración de plataforma con segundo factor, sin que nada de esto le abra puertas.
 *
 * ## La pregunta de esta suite
 *
 * El segundo factor y la reautenticación demuestran QUIÉN es el administrador. La tentación —y
 * el fallo que habría que buscar en cualquier sistema así— es que demostrar quién eres acabe
 * concediendo algo: una membresía, una ruta de cliente, un documento.
 *
 * Aquí se comprueba lo contrario en cada punto: con el segundo factor activo, con la ventana
 * de reautenticación recién abierta y con una concesión vigente, el administrador sigue sin
 * pertenecer a ninguna empresa y sigue viendo exactamente lo que su alcance permite.
 */
describe('plataforma: segundo factor y reautenticación sin bypass', () => {
  let admin: TestActor;
  let tenant: TestTenant;

  beforeAll(async () => {
    await startTestApp();
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    admin = await registerPlatformAdmin();
    tenant = await createTenant('plataforma-mfa');
  });

  afterEach(async () => {
    await destroyTenant(tenant);
    await prisma.user.deleteMany({ where: { id: admin.userId } });
  });

  // ── Obligatorio ────────────────────────────────────────────────────────────

  describe('el segundo factor es obligatorio para administrar', () => {
    it('CRÍTICO: sin él, ninguna ruta de administración responde', async () => {
      const sinMfa = await registerPlatformAdminWithoutMfa();

      const rutas = [
        '/platform/overview',
        '/platform/organizations',
        '/platform/users',
        '/platform/audit',
      ];
      const respuestas: Record<string, number> = {};
      for (const ruta of rutas) {
        respuestas[ruta] = (await as(sinMfa).get(ruta)).status;
      }

      expect(
        Object.entries(respuestas).filter(([, status]) => status !== 403),
      ).toEqual([]);

      await prisma.user.deleteMany({ where: { id: sinMfa.userId } });
    });

    it('CRÍTICO: sin él, tampoco puede pedir acceso a una empresa', async () => {
      const sinMfa = await registerPlatformAdminWithoutMfa();
      await reauthenticate(sinMfa);

      await as(sinMfa)
        .post(`/platform/organizations/${tenant.organizationId}/access`)
        .send({
          scope: 'METADATA',
          reason: 'Investigando una incidencia real.',
        })
        .expect(403);

      await prisma.user.deleteMany({ where: { id: sinMfa.userId } });
    });

    it('pero sí puede entrar y activarlo: si no, el requisito sería imposible', async () => {
      const sinMfa = await registerPlatformAdminWithoutMfa();

      await as(sinMfa).get('/auth/me').expect(200);
      await as(sinMfa).post('/auth/mfa/setup').expect(200);

      const conMfa = await enableMfa(sinMfa);
      await as(conMfa).get('/platform/overview').expect(200);

      await prisma.user.deleteMany({ where: { id: sinMfa.userId } });
    });

    it('a un cliente NO se le obliga', async () => {
      // Decisión de producto explícita: obligar al propietario de una PYME significaría que
      // el primer día del piloto no puede entrar hasta instalarse una aplicación en el móvil.
      await as(tenant.owner, tenant)
        .get(`/organizations/${tenant.organizationId}`)
        .expect(200);

      const estado = await as(tenant.owner).get('/auth/mfa').expect(200);
      expect(estado.body.data.enabled).toBe(false);
    });
  });

  // ── Reautenticación en acciones administrativas ────────────────────────────

  describe('las acciones administrativas exigen credencial reciente', () => {
    it('CRÍTICO: pedir una concesión, sin reautenticarse, se deniega', async () => {
      await as(admin)
        .post(`/platform/organizations/${tenant.organizationId}/access`)
        .send({
          scope: 'METADATA',
          reason: 'Investigando una incidencia real.',
        })
        .expect(403);
    });

    it('reautenticándose con el código, se permite', async () => {
      await as(admin)
        .post('/auth/reauthenticate')
        .send({ code: codeFor(admin) })
        .expect(200);

      await as(admin)
        .post(`/platform/organizations/${tenant.organizationId}/access`)
        .send({
          scope: 'METADATA',
          reason: 'Investigando una incidencia real.',
        })
        .expect(201);
    });

    it('CRÍTICO: banear y cambiar de plan también la exigen', async () => {
      const respuestas = {
        ban: (
          await as(admin).post(`/platform/users/${tenant.owner.userId}/ban`)
        ).status,
        plan: (
          await as(admin)
            .post(`/platform/organizations/${tenant.organizationId}/plan`)
            .send({ planTier: 'PRO' })
        ).status,
      };

      expect(respuestas).toEqual({ ban: 403, plan: 403 });
    });

    it('CRÍTICO: pasada la ventana, vuelve a exigirla', async () => {
      await reauthenticate(admin);
      await expireReauthentication(admin);

      await as(admin)
        .post(`/platform/organizations/${tenant.organizationId}/access`)
        .send({
          scope: 'METADATA',
          reason: 'Investigando una incidencia real.',
        })
        .expect(403);
    });

    it('CRÍTICO: LEER con una concesión ya vigente NO vuelve a pedirla', async () => {
      // Decisión explícita: convertir una investigación en un teclado de códigos empujaría a
      // pedir concesiones más largas para no tener que repetir, que es el resultado contrario.
      await reauthenticate(admin);
      await as(admin)
        .post(`/platform/organizations/${tenant.organizationId}/access`)
        .send({
          scope: 'METADATA',
          reason: 'Investigando una incidencia real.',
        })
        .expect(201);

      await expireReauthentication(admin);

      await as(admin)
        .get(`/platform/organizations/${tenant.organizationId}/overview`)
        .expect(200);
    });
  });

  // ── Nada de esto concede nada ──────────────────────────────────────────────

  describe('demostrar quién eres no concede nada', () => {
    it('CRÍTICO: con segundo factor activo, sigue sin tener membresías', async () => {
      const me = await as(admin).get('/auth/me').expect(200);

      expect(me.body.data.mfaEnabled).toBe(true);
      expect(me.body.data.memberships).toEqual([]);
    });

    it('CRÍTICO: reautenticado, sigue sin tener membresías', async () => {
      await reauthenticate(admin);

      const me = await as(admin).get('/auth/me').expect(200);
      expect(me.body.data.reauthenticatedUntil).toEqual(expect.any(String));
      expect(me.body.data.memberships).toEqual([]);

      expect(
        await prisma.membership.count({ where: { userId: admin.userId } }),
      ).toBe(0);
    });

    it('CRÍTICO: reautenticado, las rutas de cliente le siguen cerradas', async () => {
      await reauthenticate(admin);

      const respuestas: Record<string, number> = {};
      for (const ruta of [
        `/organizations/${tenant.organizationId}`,
        `/organizations/${tenant.organizationId}/knowledge-items`,
        `/organizations/${tenant.organizationId}/export`,
        `/organizations/${tenant.organizationId}/platform-access`,
      ]) {
        respuestas[ruta] = (await as(admin).get(ruta)).status;
      }

      expect(
        Object.entries(respuestas).filter(([, status]) => status === 200),
      ).toEqual([]);
    });

    it('CRÍTICO: sin concesión, no ve nada de la empresa aunque esté reautenticado', async () => {
      await reauthenticate(admin);

      const respuestas: Record<string, number> = {};
      for (const ruta of ['overview', 'diagnostics', 'documents']) {
        respuestas[ruta] = (
          await as(admin).get(
            `/platform/organizations/${tenant.organizationId}/${ruta}`,
          )
        ).status;
      }

      expect(respuestas).toEqual({
        overview: 403,
        diagnostics: 403,
        documents: 403,
      });
    });
  });

  // ── Los alcances de la Fase 3 no se han movido ─────────────────────────────

  describe('los alcances siguen siendo independientes', () => {
    beforeEach(async () => {
      await reauthenticate(admin);
    });

    it('CRÍTICO: con METADATA, solo metadatos', async () => {
      await conceder(admin, tenant, 'METADATA');

      await as(admin)
        .get(`/platform/organizations/${tenant.organizationId}/overview`)
        .expect(200);
      await as(admin)
        .get(`/platform/organizations/${tenant.organizationId}/diagnostics`)
        .expect(403);
      await as(admin)
        .get(`/platform/organizations/${tenant.organizationId}/documents`)
        .expect(403);
    });

    it('CRÍTICO: con DIAGNOSTICS, solo diagnóstico', async () => {
      await conceder(admin, tenant, 'DIAGNOSTICS');

      await as(admin)
        .get(`/platform/organizations/${tenant.organizationId}/diagnostics`)
        .expect(200);
      await as(admin)
        .get(`/platform/organizations/${tenant.organizationId}/overview`)
        .expect(403);
      await as(admin)
        .get(`/platform/organizations/${tenant.organizationId}/documents`)
        .expect(403);
    });

    it('CRÍTICO: CONTENT sigue necesitando que lo apruebe el propietario', async () => {
      const concesion = await conceder(admin, tenant, 'CONTENT');

      // Pendiente: pedirla no la abre, ni con segundo factor ni reautenticado.
      await as(admin)
        .get(`/platform/organizations/${tenant.organizationId}/documents`)
        .expect(403);

      await reauthenticate(tenant.owner);
      await as(tenant.owner, tenant)
        .post(
          `/organizations/${tenant.organizationId}/platform-access/${concesion}/approve`,
        )
        .expect(201);

      await as(admin)
        .get(`/platform/organizations/${tenant.organizationId}/documents`)
        .expect(200);
    });

    it('CRÍTICO: retirar la concesión deniega en el acto', async () => {
      const concesion = await conceder(admin, tenant, 'METADATA');
      await as(admin)
        .get(`/platform/organizations/${tenant.organizationId}/overview`)
        .expect(200);

      await as(admin)
        .post(
          `/platform/organizations/${tenant.organizationId}/access/${concesion}/revoke`,
        )
        .expect(201);

      await as(admin)
        .get(`/platform/organizations/${tenant.organizationId}/overview`)
        .expect(403);
    });

    it('CRÍTICO: una concesión no crea ninguna membresía', async () => {
      await conceder(admin, tenant, 'METADATA');

      expect(
        await prisma.membership.count({ where: { userId: admin.userId } }),
      ).toBe(0);
      const me = await as(admin).get('/auth/me').expect(200);
      expect(me.body.data.memberships).toEqual([]);
    });
  });

  // ── El propietario aprobando, también con credencial reciente ──────────────

  it('CRÍTICO: el propietario no puede aprobar acceso a su contenido sin reautenticarse', async () => {
    await reauthenticate(admin);
    const concesion = await conceder(admin, tenant, 'CONTENT');

    await as(tenant.owner, tenant)
      .post(
        `/organizations/${tenant.organizationId}/platform-access/${concesion}/approve`,
      )
      .expect(403);

    // Y sigue sin abrirse.
    await as(admin)
      .get(`/platform/organizations/${tenant.organizationId}/documents`)
      .expect(403);
  });

  it('la entrada de auditoría del intento denegado no lleva ningún secreto', async () => {
    await as(admin)
      .post(`/platform/organizations/${tenant.organizationId}/access`)
      .send({ scope: 'METADATA', reason: 'Investigando una incidencia real.' })
      .expect(403);

    const traza = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: admin.userId, action: 'auth.sensitive_action_denied' },
    });
    const serializado = JSON.stringify(traza);

    expect(serializado).not.toContain(admin.mfaSecret);
    expect(serializado).not.toContain(admin.password);
    expect(serializado).not.toContain(admin.accessToken);
  });
});

/** Pide una concesión y devuelve su identificador. */
async function conceder(
  admin: TestActor,
  tenant: TestTenant,
  scope: 'METADATA' | 'DIAGNOSTICS' | 'CONTENT',
): Promise<string> {
  const respuesta = await as(admin)
    .post(`/platform/organizations/${tenant.organizationId}/access`)
    .send({ scope, reason: `Investigando ${scope} por una incidencia real.` })
    .expect(201);

  return respuesta.body.data.id;
}

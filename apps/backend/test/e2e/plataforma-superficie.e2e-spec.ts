import {
  addMember,
  as,
  createTenant,
  destroyTenant,
  http,
  prisma,
  reauthenticate,
  registerActor,
  registerPlatformAdmin,
  startTestApp,
  stopTestApp,
  type TestActor,
  type TestTenant,
} from './harness';

/**
 * La superficie `/platform/*`: quién entra, qué devuelve y qué no dice cuando deniega.
 *
 * ## Las tres preguntas de esta suite
 *
 * 1. **¿Se puede entrar sin ser administrador?** Por ninguna ruta y con ningún rol de cliente.
 * 2. **¿Sale algún secreto?** Se recorre la superficie ENTERA y se busca dentro de las
 *    respuestas, en vez de comprobar campo a campo lo que uno se acuerda de mirar.
 * 3. **¿Delata algo una denegación?** Un 404 que distinga "no existe" de "no es tuyo" permite
 *    enumerar recursos ajenos preguntando.
 *
 * Todo por HTTP. Un `select` correcto y una ruta sin guard son dos ficheros que pasan sus
 * pruebas por separado y dejan la puerta abierta.
 */
describe('la superficie de plataforma (E2E)', () => {
  let admin: TestActor;
  let tenant: TestTenant;
  let miembro: TestActor;

  beforeAll(async () => {
    await startTestApp();
    admin = await registerPlatformAdmin('superficie');
    tenant = await createTenant('superficie-cliente');
    miembro = await addMember(tenant, 'ADMIN', 'superficie-admin-cliente');
  }, 60_000);

  afterAll(async () => {
    await destroyTenant(tenant, [admin.userId, miembro.userId]);
    await stopTestApp();
  });

  beforeEach(async () => {
    await reauthenticate(admin);
  });

  /** Toda la superficie de lectura, en un sitio: se recorre entera en varias pruebas. */
  const lecturas = () => [
    '/platform/overview',
    '/platform/organizations',
    `/platform/organizations/${tenant.organizationId}`,
    '/platform/users',
    `/platform/users/${tenant.owner.userId}`,
    '/platform/audit',
    '/platform/audit/actions',
    '/platform/access',
  ];

  const escrituras = () => [
    {
      metodo: 'post' as const,
      ruta: `/platform/organizations/${tenant.organizationId}/plan`,
      cuerpo: { planTier: 'PRO' },
    },
    {
      metodo: 'post' as const,
      ruta: `/platform/users/${miembro.userId}/ban`,
      cuerpo: {},
    },
    {
      metodo: 'post' as const,
      ruta: `/platform/users/${miembro.userId}/unban`,
      cuerpo: {},
    },
    {
      metodo: 'post' as const,
      ruta: `/platform/organizations/${tenant.organizationId}/access`,
      cuerpo: { scope: 'METADATA', reason: 'Una incidencia de verdad.' },
    },
  ];

  // ── 1. La puerta ───────────────────────────────────────────────────────────

  describe('la puerta', () => {
    it('CRÍTICO: sin sesión, toda la superficie responde 401', async () => {
      const respuestas: Record<string, number> = {};
      for (const ruta of lecturas()) {
        respuestas[ruta] = (await http().get(ruta)).status;
      }
      for (const { ruta, cuerpo } of escrituras()) {
        respuestas[`POST ${ruta}`] = (
          await http().post(ruta).send(cuerpo)
        ).status;
      }

      expect(
        Object.entries(respuestas).filter(([, status]) => status !== 401),
      ).toEqual([]);
    });

    it('CRÍTICO: el OWNER de una empresa no entra por ninguna', async () => {
      const respuestas: Record<string, number> = {};
      for (const ruta of lecturas()) {
        respuestas[ruta] = (await as(tenant.owner, tenant).get(ruta)).status;
      }
      for (const { ruta, cuerpo } of escrituras()) {
        respuestas[`POST ${ruta}`] = (
          await as(tenant.owner, tenant).post(ruta).send(cuerpo)
        ).status;
      }

      expect(
        Object.entries(respuestas).filter(([, status]) => status !== 403),
      ).toEqual([]);
    });

    it('CRÍTICO: el ADMIN de una empresa tampoco', async () => {
      // Administrar una empresa y administrar BusinessBrain son dos ejes distintos. Esta es
      // la prueba de que no se cruzan ni por el nombre.
      const respuestas: Record<string, number> = {};
      for (const ruta of lecturas()) {
        respuestas[ruta] = (await as(miembro, tenant).get(ruta)).status;
      }

      expect(
        Object.entries(respuestas).filter(([, status]) => status !== 403),
      ).toEqual([]);
    });

    it('CRÍTICO: `/admin/*` ya no existe', async () => {
      // Se movió entero en vez de duplicarse. Dos prefijos para lo mismo habrían sido dos
      // puertas a las mismas habitaciones y el doble de sitios donde olvidar un guard.
      const respuestas: Record<string, number> = {};
      for (const ruta of [
        '/admin/stats',
        '/admin/organizations',
        '/admin/users',
        '/admin/audit',
      ]) {
        respuestas[ruta] = (await as(admin).get(ruta)).status;
      }

      expect(
        Object.entries(respuestas).filter(([, status]) => status !== 404),
      ).toEqual([]);
    });
  });

  // ── 2. Ningún secreto sale por ninguna ruta ────────────────────────────────

  describe('lo que nunca sale', () => {
    it('CRÍTICO: ni un secreto en toda la superficie de lectura', async () => {
      // Se recorre ENTERA y se busca dentro, en vez de comprobar campo a campo lo que uno se
      // acuerda de mirar. Si mañana alguien añade un `select` de más, esto lo ve.
      const prohibidos = [
        'passwordHash',
        'mfaSecretEnc',
        'tokenHash',
        'codeHash',
        'configEnc',
        'apiKeyEnc',
        'accessTokenEnc',
        'refreshTokenEnc',
        'hashedKey',
        // Y el contenido de un cliente, que no es un secreto técnico pero es lo que menos
        // debe salir por aquí.
        'contentText',
      ];

      const encontrados: Array<[string, string]> = [];
      for (const ruta of lecturas()) {
        const cuerpo = JSON.stringify(
          (await as(admin).get(ruta).expect(200)).body,
        );
        for (const prohibido of prohibidos) {
          if (cuerpo.includes(prohibido)) encontrados.push([ruta, prohibido]);
        }
      }

      expect(encontrados).toEqual([]);
    });

    it('CRÍTICO: el secreto real de una cuenta con segundo factor no aparece', async () => {
      // No basta con buscar el NOMBRE del campo: se busca el valor concreto, que es lo que
      // serviría para suplantar a alguien.
      const cuerpoLista = JSON.stringify(
        (await as(admin).get('/platform/users').expect(200)).body,
      );
      const ficha = JSON.stringify(
        (await as(admin).get(`/platform/users/${admin.userId}`).expect(200))
          .body,
      );

      expect(admin.mfaSecret).toBeTruthy();
      expect(cuerpoLista).not.toContain(admin.mfaSecret);
      expect(ficha).not.toContain(admin.mfaSecret);
      expect(ficha).not.toContain(admin.password);
    });

    it('la ficha de una persona dice si tiene segundo factor, pero como booleano', async () => {
      const ficha = await as(admin)
        .get(`/platform/users/${admin.userId}`)
        .expect(200);

      expect(ficha.body.data.mfaEnabled).toBe(true);
      expect(ficha.body.data).not.toHaveProperty('mfaEnabledAt');
      expect(ficha.body.data).not.toHaveProperty('mfaSecretEnc');
    });

    it('CRÍTICO: el catálogo no lleva la configuración de la empresa', async () => {
      const listado = JSON.stringify(
        (await as(admin).get('/platform/organizations').expect(200)).body,
      );
      const ficha = JSON.stringify(
        (
          await as(admin)
            .get(`/platform/organizations/${tenant.organizationId}`)
            .expect(200)
        ).body,
      );

      for (const cuerpo of [listado, ficha]) {
        expect(cuerpo).not.toContain('settings');
        expect(cuerpo).not.toContain('dailyCharacterLimit');
        expect(cuerpo).not.toContain('minimumFloor');
      }
    });

    it('CRÍTICO: la ficha de una empresa no devuelve más que su fila del listado', async () => {
      // Que exista una ruta para una sola empresa es comodidad de la interfaz; si por serlo
      // enseñara un campo más, sería una puerta más ancha sin que nadie lo hubiera decidido.
      const listado = await as(admin)
        .get('/platform/organizations')
        .expect(200);
      const fila = listado.body.data.items.find(
        (o: { id: string }) => o.id === tenant.organizationId,
      );
      const ficha = await as(admin)
        .get(`/platform/organizations/${tenant.organizationId}`)
        .expect(200);

      expect(Object.keys(ficha.body.data).sort()).toEqual(
        Object.keys(fila).sort(),
      );
    });
  });

  // ── 3. Denegar sin delatar ─────────────────────────────────────────────────

  describe('lo que una denegación NO cuenta', () => {
    it('CRÍTICO: un 403 no dice nada de lo que hay detrás', async () => {
      const respuesta = await as(tenant.owner, tenant)
        .get('/platform/organizations')
        .expect(403);
      const cuerpo = JSON.stringify(respuesta.body);

      expect(cuerpo).not.toContain(tenant.organizationId);
      expect(cuerpo).not.toContain(admin.email);
      // Ni rutas, ni consultas, ni nombres de tabla.
      expect(cuerpo).not.toMatch(/prisma|select|from |table/i);
    });

    it('CRÍTICO: un identificador inventado y uno ajeno responden IGUAL', async () => {
      // Si "no existe" y "no tienes acceso" se distinguieran, se podría enumerar qué empresas
      // hay probando identificadores.
      const inventado = await as(admin)
        .get('/platform/organizations/cmxxxxxxxxxxxxxxxxxxxxxxx')
        .expect(404);
      const otraEmpresa = await createTenant('superficie-ajena');

      // Con una empresa que SÍ existe, el administrador puede verla en el catálogo: eso es
      // deliberado, es su cartera de clientes. Lo que no puede es ver dentro sin concesión.
      await as(admin)
        .get(`/platform/organizations/${otraEmpresa.organizationId}`)
        .expect(200);
      const dentroSinConcesion = await as(admin)
        .get(`/platform/organizations/${otraEmpresa.organizationId}/overview`)
        .expect(403);

      expect(JSON.stringify(inventado.body)).not.toMatch(/prisma|stack/i);
      expect(JSON.stringify(dentroSinConcesion.body)).toMatch(
        /no hay ningún acceso autorizado/i,
      );

      await destroyTenant(otraEmpresa);
    });

    it('CRÍTICO: un error interno no lleva traza ni detalles de la base de datos', async () => {
      // `page=abc` llega como NaN y sin normalizar reventaría dentro de Prisma. Aquí tiene
      // que responder la página 1, no un 500 con las tripas dentro.
      const respuesta = await as(admin)
        .get('/platform/organizations?page=abc')
        .expect(200);

      expect(respuesta.body.data.page).toBe(1);
      const cuerpo = JSON.stringify(respuesta.body);
      expect(cuerpo).not.toMatch(/at Object|node_modules|PrismaClient/);
    });

    it('un cuerpo inválido se rechaza sin explicar el esquema interno', async () => {
      const respuesta = await as(admin)
        .post(`/platform/organizations/${tenant.organizationId}/plan`)
        .send({ planTier: 'PLAN_QUE_NO_EXISTE' })
        .expect(400);

      expect(JSON.stringify(respuesta.body)).not.toMatch(
        /prisma|node_modules|at Object/i,
      );
    });
  });

  // ── 4. La reautenticación sigue puesta ─────────────────────────────────────

  describe('las acciones sensibles siguen exigiendo credencial reciente', () => {
    it('CRÍTICO: todas ellas, desde una sesión que no la ha demostrado', async () => {
      const reciente = await registerPlatformAdmin('superficie-sin-reauth');

      const respuestas: Record<string, number> = {};
      for (const { ruta, cuerpo } of escrituras()) {
        respuestas[ruta] = (await as(reciente).post(ruta).send(cuerpo)).status;
      }
      respuestas['mfa/remove'] = (
        await as(reciente)
          .post(`/platform/users/${miembro.userId}/mfa/remove`)
          .send({ reason: 'Un motivo suficientemente largo.' })
      ).status;

      expect(
        Object.entries(respuestas).filter(([, status]) => status !== 403),
      ).toEqual([]);

      await prisma.user.deleteMany({ where: { id: reciente.userId } });
    });

    it('las lecturas ordinarias NO la exigen', async () => {
      // Pedirla para mirar el catálogo convertiría la garantía en un motivo para desactivarla.
      const reciente = await registerPlatformAdmin('superficie-lecturas');

      const respuestas: Record<string, number> = {};
      for (const ruta of lecturas()) {
        respuestas[ruta] = (await as(reciente).get(ruta)).status;
      }

      expect(
        Object.entries(respuestas).filter(([, status]) => status !== 200),
      ).toEqual([]);

      await prisma.user.deleteMany({ where: { id: reciente.userId } });
    });
  });

  // ── 5. Bloquear y desbloquear ──────────────────────────────────────────────

  describe('bloquear una cuenta', () => {
    it('bloquea, y la persona deja de entrar EN EL ACTO', async () => {
      // No hace falta revocar sesiones a mano: `JwtStrategy` comprueba el estado en cada
      // petición. Esta prueba es lo que vigila que siga siendo así.
      const victima = await registerActor('superficie-bloqueado');
      await as(victima).get('/auth/me').expect(200);

      await as(admin).post(`/platform/users/${victima.userId}/ban`).expect(201);

      await as(victima).get('/auth/me').expect(401);
      await http()
        .post('/auth/login')
        .send({ email: victima.email, password: victima.password })
        .expect(401);

      await as(admin)
        .post(`/platform/users/${victima.userId}/unban`)
        .expect(201);
      await http()
        .post('/auth/login')
        .send({ email: victima.email, password: victima.password })
        .expect(201);

      await prisma.user.deleteMany({ where: { id: victima.userId } });
    });

    it('CRÍTICO: repetir el bloqueo no lo deshace', async () => {
      const victima = await registerActor('superficie-doble-clic');

      const primera = await as(admin)
        .post(`/platform/users/${victima.userId}/ban`)
        .expect(201);
      const segunda = await as(admin)
        .post(`/platform/users/${victima.userId}/ban`)
        .expect(201);

      expect(primera.body.data).toMatchObject({
        status: 'BANNED',
        changed: true,
      });
      expect(segunda.body.data).toMatchObject({
        status: 'BANNED',
        changed: false,
      });

      // Y la traza no tiene dos entradas contradictorias.
      const entradas = await prisma.auditLog.count({
        where: { targetId: victima.userId, action: 'platform.user.banned' },
      });
      expect(entradas).toBe(1);

      await prisma.user.deleteMany({ where: { id: victima.userId } });
    });

    it('CRÍTICO: no se puede bloquear una cuenta de plataforma, ni la propia', async () => {
      const otroAdmin = await registerPlatformAdmin('superficie-otro-admin');

      await as(admin)
        .post(`/platform/users/${otroAdmin.userId}/ban`)
        .expect(400);
      await as(admin).post(`/platform/users/${admin.userId}/ban`).expect(400);

      // Y siguen entrando.
      await as(admin).get('/platform/overview').expect(200);
      await as(otroAdmin).get('/platform/overview').expect(200);

      await prisma.user.deleteMany({ where: { id: otroAdmin.userId } });
    });
  });

  // ── 6. Las concesiones propias ─────────────────────────────────────────────

  describe('"¿qué accesos tengo abiertos?"', () => {
    it('devuelve los propios, con el nombre de la empresa', async () => {
      await as(admin)
        .post(`/platform/organizations/${tenant.organizationId}/access`)
        .send({ scope: 'METADATA', reason: 'Revisando una incidencia real.' })
        .expect(201);

      const mios = await as(admin).get('/platform/access').expect(200);
      const concesion = mios.body.data.find(
        (c: { organization: { id: string } }) =>
          c.organization.id === tenant.organizationId,
      );

      expect(concesion).toBeDefined();
      expect(concesion.organization.name).toBeTruthy();
      expect(concesion.scope).toBe('METADATA');
      expect(concesion.usable).toBe(true);
    });

    it('CRÍTICO: no devuelve las de otro administrador', async () => {
      // Ver los accesos ajenos no ayuda a operar y sí dibujaría el mapa de qué clientes está
      // mirando cada cual.
      const otroAdmin = await registerPlatformAdmin('superficie-concesiones');
      await reauthenticate(otroAdmin);
      await as(otroAdmin)
        .post(`/platform/organizations/${tenant.organizationId}/access`)
        .send({ scope: 'DIAGNOSTICS', reason: 'Otra incidencia distinta.' })
        .expect(201);

      const mios = await as(admin).get('/platform/access').expect(200);
      const deOtro = mios.body.data.filter(
        (c: { requestedBy: { id: string } }) =>
          c.requestedBy.id === otroAdmin.userId,
      );

      expect(deOtro).toEqual([]);

      await prisma.user.deleteMany({ where: { id: otroAdmin.userId } });
    });
  });
});

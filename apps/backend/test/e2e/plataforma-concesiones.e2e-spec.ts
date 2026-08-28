import {
  addMember,
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
 * Acceso administrativo a los datos de una empresa (E2E).
 *
 * ## Lo que esta suite demuestra
 *
 * Que **administrar BusinessBrain no es ser superusuario de los datos de los clientes**. El rol
 * de plataforma, por sí solo, no devuelve ni un contador de una empresa. Hace falta una
 * concesión: motivada, de un alcance concreto, con fecha de fin, y —para el contenido— aprobada
 * por el propietario.
 *
 * ## Y las dos cosas que más importan
 *
 * Que los alcances no se arrastran entre sí: tener metadatos no abre diagnóstico ni contenido.
 * Y que una concesión **no crea ninguna membresía**: al terminar, el administrador sigue sin
 * pertenecer a nada, y la API de cliente le sigue respondiendo como a un desconocido.
 */
describe('Concesiones de acceso de plataforma (E2E)', () => {
  let admin: TestActor;
  let otroAdmin: TestActor;
  let tenant: TestTenant;
  let documentoId: string;
  const extranos: string[] = [];

  beforeAll(async () => {
    await startTestApp();
    admin = await registerPlatformAdmin('concesiones');
    otroAdmin = await registerPlatformAdmin('concesiones-otro');
    tenant = await createTenant('concesiones-cliente');

    // Contenido real de la empresa: sin él, "el administrador no ve el contenido" pasaría
    // por no haber contenido que ver.
    const fuente = await prisma.knowledgeSource.create({
      data: {
        organizationId: tenant.organizationId,
        type: 'FILE_UPLOAD',
        name: 'Contratos',
        connectorKey: 'file_upload_v1',
        createdById: tenant.owner.userId,
        status: 'CONNECTED',
        configEnc: '',
        lastError: 'No se pudo leer "Contrato Ruiz.pdf": fichero dañado',
      },
    });
    const documento = await prisma.knowledgeItem.create({
      data: {
        organizationId: tenant.organizationId,
        originKnowledgeSourceId: fuente.id,
        currentKnowledgeSourceId: fuente.id,
        title: 'Contrato con Distribuciones Ruiz',
        contentText: 'El descuento máximo autorizado es del quince por ciento.',
        contentHash: `concesiones-${Date.now()}`,
        status: 'INDEXED',
        indexedAt: new Date(),
      },
    });
    documentoId = documento.id;
  });

  afterAll(async () => {
    await destroyTenant(tenant, [admin.userId, otroAdmin.userId, ...extranos]);
    await stopTestApp();
  });

  const comoAdmin = (actor: TestActor = admin) => ({
    get: (url: string) =>
      http().get(url).set('Authorization', `Bearer ${actor.accessToken}`),
    post: (url: string) =>
      http().post(url).set('Authorization', `Bearer ${actor.accessToken}`),
  });

  const base = () => `/admin/organizations/${tenant.organizationId}`;
  const clienteBase = () =>
    `/organizations/${tenant.organizationId}/platform-access`;

  interface Concesion {
    id: string;
    scope: string;
    status: string;
    usable: boolean;
    expired: boolean;
    reason: string;
    expiresAt: string;
    approvedBy: { id: string; name: string } | null;
    revokedBy: { id: string; name: string } | null;
  }

  const pedir = async (
    scope: string,
    reason = 'Investigando la incidencia 14 del cliente',
    actor: TestActor = admin,
  ): Promise<Concesion> => {
    const respuesta = await comoAdmin(actor)
      .post(`${base()}/access`)
      .send({ scope, reason })
      .expect(201);
    return (respuesta.body as { data: Concesion }).data;
  };

  const retirarTodas = async () => {
    await prisma.platformAccessGrant.deleteMany({
      where: { organizationId: tenant.organizationId },
    });
  };

  /**
   * Antes de cada prueba, los tres actores demuestran quiénes son.
   *
   * Pedir una concesión, aprobarla y retirarla son acciones sensibles desde la Fase 4: exigen
   * credencial reciente. Reautenticar aquí no es esconder ese guard —tiene su propia suite, y
   * `plataforma-mfa.e2e-spec.ts` comprueba que sin esto se deniega— sino poner a estos actores
   * en el estado en el que estaría una persona real: quien va a conceder acceso a los datos de
   * un cliente acaba de confirmar su identidad.
   */
  beforeEach(async () => {
    await retirarTodas();
    await reauthenticate(admin);
    await reauthenticate(otroAdmin);
    await reauthenticate(tenant.owner);
  });

  describe('sin concesión no hay nada', () => {
    it('CRÍTICO: el rol de plataforma NO da acceso a los datos de una empresa', async () => {
      // Es la regla entera de esta fase. Ser administrador abre la puerta de la operación, no
      // la de los negocios ajenos.
      for (const ruta of ['overview', 'diagnostics', 'documents']) {
        const respuesta = await comoAdmin()
          .get(`${base()}/${ruta}`)
          .expect(403);
        expect(JSON.stringify(respuesta.body)).toMatch(
          /no hay ningún acceso autorizado/i,
        );
      }

      await comoAdmin().get(`${base()}/documents/${documentoId}`).expect(403);
    });

    it('la denegación no revela si existe un acceso de otro alcance', async () => {
      // Quien pregunta por un acceso que no tiene no debería poder deducir el mapa de accesos
      // ajenos a base de probar combinaciones.
      await pedir('METADATA');

      const sinAlcance = await comoAdmin()
        .get(`${base()}/diagnostics`)
        .expect(403);
      const sinNada = await comoAdmin().get(`${base()}/documents`).expect(403);

      // Se compara el MENSAJE, no el cuerpo entero: la marca de tiempo del filtro de errores
      // difiere en milisegundos y compararla no dice nada sobre lo que se filtra.
      const mensajeDe = (respuesta: { body: unknown }) =>
        (respuesta.body as { error?: { message?: string } }).error?.message ??
        '';

      expect(mensajeDe(sinAlcance)).toBe(mensajeDe(sinNada));
      expect(mensajeDe(sinAlcance)).toMatch(/no hay ningún acceso autorizado/i);
    });
  });

  describe('pedir un acceso', () => {
    it('metadatos y diagnóstico nacen utilizables', async () => {
      const concesion = await pedir('METADATA');

      expect(concesion.status).toBe('ACTIVE');
      expect(concesion.usable).toBe(true);
      expect(new Date(concesion.expiresAt).getTime()).toBeGreaterThan(
        Date.now(),
      );

      await comoAdmin().get(`${base()}/overview`).expect(200);
    });

    it('CRÍTICO: sin motivo no hay concesión', async () => {
      // Un acceso sin motivo no se puede auditar después: la traza diría que alguien miró y
      // no por qué, que es la mitad de la pregunta.
      for (const motivo of ['', '   ', 'x', 'prueba']) {
        await comoAdmin()
          .post(`${base()}/access`)
          .send({ scope: 'METADATA', reason: motivo })
          .expect(400);
      }

      await expect(
        prisma.platformAccessGrant.count({
          where: { organizationId: tenant.organizationId },
        }),
      ).resolves.toBe(0);
    });

    it('CRÍTICO: nunca se concede acceso indefinido', async () => {
      // Ni pidiendo un plazo absurdo. Se recorta al techo del alcance.
      const respuesta = await comoAdmin()
        .post(`${base()}/access`)
        .send({
          scope: 'METADATA',
          reason: 'Revisión operativa de la cuenta',
          hours: 24 * 7 * 10,
        });

      // O lo rechaza la validación, o lo recorta. Lo que no puede es durar más de una semana.
      if (respuesta.status === 201) {
        const concesion = (respuesta.body as { data: Concesion }).data;
        const maximo = Date.now() + 7 * 24 * 3600_000 + 60_000;
        expect(new Date(concesion.expiresAt).getTime()).toBeLessThanOrEqual(
          maximo,
        );
      } else {
        expect(respuesta.status).toBe(400);
      }
    });

    it('el metadato es metadato: ni una línea de contenido', async () => {
      await pedir('METADATA');
      const respuesta = await comoAdmin().get(`${base()}/overview`).expect(200);

      const cuerpo = JSON.stringify(respuesta.body);
      expect(cuerpo).not.toContain('quince por ciento');
      expect(cuerpo).not.toContain('Contrato con Distribuciones Ruiz');
      expect(cuerpo).not.toContain('configEnc');
      // Lo que sí: nombres de fuentes, estados y contadores.
      expect(cuerpo).toContain('Contratos');
      expect(cuerpo).toContain('counts');
    });

    it('el diagnóstico no abre el contenido de los documentos', async () => {
      await pedir('DIAGNOSTICS');
      const respuesta = await comoAdmin()
        .get(`${base()}/diagnostics`)
        .expect(200);

      const cuerpo = JSON.stringify(respuesta.body);
      // El mensaje de error puede citar el NOMBRE del fichero que falló —no se investiga "un
      // documento falló" sin saber cuál— pero nunca su contenido.
      expect(cuerpo).toContain('fichero dañado');
      expect(cuerpo).not.toContain('quince por ciento');
    });
  });

  describe('los alcances son independientes', () => {
    it('CRÍTICO: METADATA no permite CONTENT', async () => {
      await pedir('METADATA');

      await comoAdmin().get(`${base()}/overview`).expect(200);
      await comoAdmin().get(`${base()}/documents`).expect(403);
      await comoAdmin().get(`${base()}/documents/${documentoId}`).expect(403);
    });

    it('CRÍTICO: DIAGNOSTICS no permite CONTENT', async () => {
      await pedir('DIAGNOSTICS');

      await comoAdmin().get(`${base()}/diagnostics`).expect(200);
      await comoAdmin().get(`${base()}/documents`).expect(403);
    });

    it('CRÍTICO: METADATA y DIAGNOSTICS tampoco se abren entre sí', async () => {
      await pedir('METADATA');

      await comoAdmin().get(`${base()}/diagnostics`).expect(403);
    });

    it('CRÍTICO: la concesión es de quien la pidió', async () => {
      // Otra cuenta de plataforma no la hereda. Es lo que impide que una identidad distinta
      // —humana o no— reutilice un acceso ajeno.
      await pedir(
        'METADATA',
        'Investigando la incidencia 14 del cliente',
        admin,
      );

      await comoAdmin(admin).get(`${base()}/overview`).expect(200);
      await comoAdmin(otroAdmin).get(`${base()}/overview`).expect(403);
    });
  });

  describe('el contenido lo aprueba el propietario', () => {
    it('CRÍTICO: pedirlo no lo concede', async () => {
      const concesion = await pedir(
        'CONTENT',
        'El cliente reporta que una respuesta cita mal un contrato',
      );

      expect(concesion.status).toBe('PENDING');
      expect(concesion.usable).toBe(false);

      const respuesta = await comoAdmin()
        .get(`${base()}/documents`)
        .expect(403);
      expect(JSON.stringify(respuesta.body)).toMatch(/todavía no ha aprobado/i);
    });

    it('CRÍTICO: aprobado por el OWNER, y entonces sí', async () => {
      const concesion = await pedir(
        'CONTENT',
        'El cliente reporta que una respuesta cita mal un contrato',
      );

      await as(tenant.owner, tenant)
        .post(`${clienteBase()}/${concesion.id}/approve`)
        .send({})
        .expect(201);

      const lista = await comoAdmin().get(`${base()}/documents`).expect(200);
      expect(JSON.stringify(lista.body)).toContain(
        'Contrato con Distribuciones Ruiz',
      );

      const documento = await comoAdmin()
        .get(`${base()}/documents/${documentoId}`)
        .expect(200);
      expect(JSON.stringify(documento.body)).toContain('quince por ciento');
    });

    it('CRÍTICO: un ADMIN de la empresa no puede aprobarlo', async () => {
      // Aprobar que alguien de fuera lea los documentos no es administración diaria: es de
      // quien responde por la empresa, igual que exportar o borrar sus datos.
      const concesion = await pedir('CONTENT', 'Revisión de una incidencia');
      const gestor = await addMember(tenant, 'ADMIN', 'concesiones-admin');
      extranos.push(gestor.userId);

      await as(gestor, tenant)
        .post(`${clienteBase()}/${concesion.id}/approve`)
        .send({})
        .expect(403);

      await comoAdmin().get(`${base()}/documents`).expect(403);
    });

    it('CRÍTICO: el propietario de OTRA empresa no puede aprobarlo', async () => {
      const concesion = await pedir('CONTENT', 'Revisión de una incidencia');
      const ajena = await createTenant('concesiones-ajena');
      extranos.push(ajena.owner.userId);
      // Se reautentica a propósito: así lo que deniega no es la falta de credencial reciente
      // —que se comprueba aparte— sino que la concesión no es suya. Sin esto, la prueba
      // pasaría por el motivo equivocado y dejaría de vigilar lo que dice vigilar.
      await reauthenticate(ajena.owner);

      // Con su propia organización activa, la concesión no existe para él.
      await as(ajena.owner, ajena)
        .post(
          `/organizations/${ajena.organizationId}/platform-access/${concesion.id}/approve`,
        )
        .send({})
        .expect(404);

      // Y apuntando a la organización ajena, ni siquiera pasa el guard de pertenencia.
      await as(ajena.owner, tenant)
        .post(`${clienteBase()}/${concesion.id}/approve`)
        .send({})
        .expect(403);
    });
  });

  describe('caducidad', () => {
    it('CRÍTICO: una concesión caducada deniega inmediatamente', async () => {
      const concesion = await pedir('METADATA');
      await comoAdmin().get(`${base()}/overview`).expect(200);

      // Se envejece la fila en vez de esperar 24 horas.
      await prisma.platformAccessGrant.update({
        where: { id: concesion.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const respuesta = await comoAdmin().get(`${base()}/overview`).expect(403);
      expect(JSON.stringify(respuesta.body)).toMatch(/ha caducado/i);
    });

    it('CRÍTICO: una petición de contenido caducada ya no se puede aprobar', async () => {
      // Si no, podría aprobarse meses después, cuando el motivo que la justificaba ya no
      // existe.
      const concesion = await pedir('CONTENT', 'Revisión de una incidencia');
      await prisma.platformAccessGrant.update({
        where: { id: concesion.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await as(tenant.owner, tenant)
        .post(`${clienteBase()}/${concesion.id}/approve`)
        .send({})
        .expect(400);

      await comoAdmin().get(`${base()}/documents`).expect(403);
    });
  });

  describe('revocación', () => {
    it('CRÍTICO: la administración puede retirar su propio acceso', async () => {
      const concesion = await pedir('METADATA');
      await comoAdmin().get(`${base()}/overview`).expect(200);

      await comoAdmin()
        .post(`${base()}/access/${concesion.id}/revoke`)
        .expect(201);

      const respuesta = await comoAdmin().get(`${base()}/overview`).expect(403);
      expect(JSON.stringify(respuesta.body)).toMatch(/se ha retirado/i);
    });

    it('CRÍTICO: el propietario puede cortar el acceso que aprobó', async () => {
      // Una aprobación que no se puede retirar es un permiso permanente hasta que caduque.
      const concesion = await pedir('CONTENT', 'Revisión de una incidencia');
      await as(tenant.owner, tenant)
        .post(`${clienteBase()}/${concesion.id}/approve`)
        .send({})
        .expect(201);
      await comoAdmin().get(`${base()}/documents`).expect(200);

      await as(tenant.owner, tenant)
        .post(`${clienteBase()}/${concesion.id}/revoke`)
        .expect(201);

      await comoAdmin().get(`${base()}/documents`).expect(403);
    });

    it('CRÍTICO: un administrador no puede retirar el acceso de otro', async () => {
      const concesion = await pedir(
        'METADATA',
        'Investigando la incidencia 14 del cliente',
        admin,
      );

      await comoAdmin(otroAdmin)
        .post(`${base()}/access/${concesion.id}/revoke`)
        .expect(403);
    });
  });

  describe('el cliente ve quién accedió, cuándo, por qué y con qué alcance', () => {
    it('CRÍTICO: el historial completo desde su propia cuenta', async () => {
      const motivo = 'El cliente reporta una cita incorrecta en una respuesta';
      const concesion = await pedir('CONTENT', motivo);
      await as(tenant.owner, tenant)
        .post(`${clienteBase()}/${concesion.id}/approve`)
        .send({})
        .expect(201);
      await comoAdmin().get(`${base()}/documents/${documentoId}`).expect(200);

      const respuesta = await as(tenant.owner, tenant)
        .get(clienteBase())
        .expect(200);
      const historial = (respuesta.body as { data: Concesion[] }).data;
      const registrada = historial.find((fila) => fila.id === concesion.id);

      // Quién lo pidió, por qué, con qué alcance, cuándo se aprobó y cuándo caduca.
      expect(registrada?.reason).toBe(motivo);
      expect(registrada?.scope).toBe('CONTENT');
      expect(registrada?.approvedBy?.id).toBe(tenant.owner.userId);
      expect(registrada?.expiresAt).toBeTruthy();
    });

    it('un miembro que no es propietario no ve el historial', async () => {
      const miembro = await addMember(tenant, 'MEMBER', 'concesiones-miembro');
      extranos.push(miembro.userId);

      await as(miembro, tenant).get(clienteBase()).expect(403);
    });
  });

  describe('una concesión NO es una membresía', () => {
    it('CRÍTICO: al terminar, el administrador sigue sin pertenecer a nada', async () => {
      const concesion = await pedir('CONTENT', 'Revisión de una incidencia');
      await as(tenant.owner, tenant)
        .post(`${clienteBase()}/${concesion.id}/approve`)
        .send({})
        .expect(201);
      await comoAdmin().get(`${base()}/documents`).expect(200);

      // Ni una membresía, ni en esta empresa ni en ninguna.
      await expect(
        prisma.membership.count({ where: { userId: admin.userId } }),
      ).resolves.toBe(0);
    });

    it('CRÍTICO: con la concesión abierta, la API de cliente le sigue denegando', async () => {
      // La concesión abre rutas de PLATAFORMA. No abre ni una ruta de tenant, y por eso el
      // aislamiento entre organizaciones no hay que tocarlo: no hay nada que puentear.
      const concesion = await pedir('CONTENT', 'Revisión de una incidencia');
      await as(tenant.owner, tenant)
        .post(`${clienteBase()}/${concesion.id}/approve`)
        .send({})
        .expect(201);

      for (const ruta of ['/knowledge-items', '/insights', '/conversations']) {
        const respuesta = await comoAdmin()
          .get(ruta)
          .set('x-org-id', tenant.organizationId);
        expect([403, 404]).toContain(respuesta.status);
      }
    });
  });

  describe('todo queda auditado, y solo en el espacio de plataforma', () => {
    it('CRÍTICO: petición, aprobación, uso y revocación', async () => {
      const concesion = await pedir('CONTENT', 'Revisión de una incidencia 22');
      await as(tenant.owner, tenant)
        .post(`${clienteBase()}/${concesion.id}/approve`)
        .send({})
        .expect(201);
      await comoAdmin().get(`${base()}/documents/${documentoId}`).expect(200);
      await comoAdmin()
        .post(`${base()}/access/${concesion.id}/revoke`)
        .expect(201);

      const trazas = await prisma.auditLog.findMany({
        where: { targetId: concesion.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(trazas.map((traza) => traza.action)).toEqual([
        'platform.access.requested',
        'platform.access.approved',
        'platform.access.used',
        'platform.access.revoked',
      ]);

      // Ninguna cuelga de la organización: la traza sobrevive al borrado del cliente.
      expect(trazas.every((traza) => traza.organizationId === null)).toBe(true);
      // Y todas llevan el motivo o el alcance, que es lo que las hace investigables.
      expect(JSON.stringify(trazas[0].metadata)).toContain('incidencia 22');
    });

    it('CRÍTICO: aparecen en la auditoría de plataforma y sin datos de más', async () => {
      const concesion = await pedir(
        'METADATA',
        'Revisión operativa de la cuenta',
      );
      await comoAdmin().get(`${base()}/overview`).expect(200);

      const respuesta = await comoAdmin().get('/admin/audit').expect(200);
      const cuerpo = JSON.stringify(respuesta.body);

      expect(cuerpo).toContain('platform.access.requested');
      expect(cuerpo).toContain('platform.access.used');
      expect(cuerpo).toContain(concesion.id);

      // Ni contenido del cliente, ni correos, ni acciones suyas.
      expect(cuerpo).not.toContain('quince por ciento');
      expect(cuerpo).not.toContain('@');

      const items = (respuesta.body as { data: { items: { code: string }[] } })
        .data.items;
      expect(
        items.every((entrada) => entrada.code.startsWith('platform.')),
      ).toBe(true);
    });
  });
});

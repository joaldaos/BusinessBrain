import {
  addMember,
  as,
  createTenant,
  destroyTenant,
  http,
  prisma,
  reauthenticate,
  registerActor,
  startTestApp,
  stopTestApp,
  type TestTenant,
} from './harness';

/**
 * Qué sabemos de una empresa, cómo se lo lleva y cómo lo borra (E2E).
 *
 * Es lo que una asesoría o una clínica preguntan en la primera reunión: dónde va el texto de
 * mis contratos, puedo llevármelo, y puedes borrarlo si me voy. Hasta ahora la respuesta a las
 * tres era "no está hecho".
 */
describe('Privacidad y datos de la empresa (E2E)', () => {
  let tenant: TestTenant;
  let adminId: string;

  beforeAll(async () => {
    await startTestApp();
    tenant = await createTenant('privacidad');
    const admin = await addMember(tenant, 'ADMIN', 'admin-privacidad');
    adminId = admin.userId;
  });

  /**
   * El propietario confirma su identidad antes de cada prueba.
   *
   * Exportar y borrar los datos de la empresa son acciones sensibles desde la Fase 4: no basta
   * con que la sesión siga viva. Que el guard esté puesto de verdad lo comprueba
   * `verificacion-dos-pasos.e2e-spec.ts`; aquí lo que se verifica es lo que estas rutas hacen
   * cuando la persona SÍ ha demostrado quién es.
   */
  beforeEach(async () => {
    await reauthenticate(tenant.owner);
  });

  afterAll(async () => {
    await destroyTenant(tenant, [adminId]);
    await stopTestApp();
  });

  describe('el aviso de qué sale hacia la IA', () => {
    it('dice qué sale, cuándo, y qué se guarda', async () => {
      const respuesta = await as(tenant.owner, tenant)
        .get('/privacy/notice')
        .expect(200);

      const aviso = (
        respuesta.body as {
          data: {
            aiProvider: { what: string; trigger: string }[];
            stored: unknown[];
            pending: string[];
          };
        }
      ).data;

      expect(aviso.aiProvider.length).toBeGreaterThan(0);
      expect(aviso.stored.length).toBeGreaterThan(0);
      // Lo que todavía no está resuelto se dice, no se calla.
      expect(aviso.pending.length).toBeGreaterThan(0);
    });

    it('está escrito para una PYME, no para un informático', async () => {
      const respuesta = await as(tenant.owner, tenant)
        .get('/privacy/notice')
        .expect(200);

      expect(JSON.stringify(respuesta.body)).not.toMatch(
        /embedding|prompt|payload|endpoint|nullable/i,
      );
    });
  });

  describe('llevarse los datos', () => {
    it('el propietario obtiene una copia con el contenido de su empresa', async () => {
      const respuesta = await as(tenant.owner, tenant)
        .get(`/organizations/${tenant.organizationId}/export`)
        .expect(200);

      const copia = (
        respuesta.body as {
          data: { empresa: { id: string }; personas: unknown[] };
        }
      ).data;

      expect(copia.empresa.id).toBe(tenant.organizationId);
      expect(copia.personas.length).toBeGreaterThan(0);
    });

    it('CRÍTICO: la copia NO lleva secretos', async () => {
      // Una copia para el cliente no puede llevar material con el que suplantar a su empresa:
      // acaba en un correo o en un disco compartido.
      const respuesta = await as(tenant.owner, tenant)
        .get(`/organizations/${tenant.organizationId}/export`)
        .expect(200);

      const texto = JSON.stringify(respuesta.body);
      expect(texto).not.toContain('configEnc');
      expect(texto).not.toContain('apiKeyEnc');
      expect(texto).not.toContain('hashedKey');
      expect(texto).not.toContain('passwordHash');
    });

    it('CRÍTICO: un administrador NO puede exportar', async () => {
      // Es un acto de quien responde por la empresa, no de quien la administra a diario.
      const admin = await prisma.membership.findFirstOrThrow({
        where: { organizationId: tenant.organizationId, role: 'ADMIN' },
      });
      expect(admin.userId).toBe(adminId);

      const login = await http()
        .post('/auth/login')
        .send({
          email: (
            await prisma.user.findUniqueOrThrow({ where: { id: adminId } })
          ).email,
          password: 'contrasena-de-prueba',
        })
        .expect(201);

      await http()
        .get(`/organizations/${tenant.organizationId}/export`)
        .set(
          'Authorization',
          `Bearer ${(login.body as { data: { accessToken: string } }).data.accessToken}`,
        )
        .set('x-org-id', tenant.organizationId)
        .expect(403);
    });

    it('CRÍTICO: el propietario de otra empresa no puede exportar esta', async () => {
      const ajeno = await registerActor('ajeno-export');

      await http()
        .get(`/organizations/${tenant.organizationId}/export`)
        .set('Authorization', `Bearer ${ajeno.accessToken}`)
        .set('x-org-id', tenant.organizationId)
        .expect(403);

      await prisma.user.deleteMany({ where: { id: ajeno.userId } });
    });

    it('queda traza de quién se llevó la copia', async () => {
      await as(tenant.owner, tenant)
        .get(`/organizations/${tenant.organizationId}/export`)
        .expect(200);

      const traza = await prisma.auditLog.findFirst({
        where: {
          organizationId: tenant.organizationId,
          action: 'organization.data_exported',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(traza).not.toBeNull();
      expect(traza?.actorId).toBe(tenant.owner.userId);
      // El recuento, no el contenido: una traza que copiara los datos exportados duplicaría
      // exactamente lo que se intenta controlar.
      expect(traza?.metadata).toMatchObject({ personas: expect.any(Number) });
    });
  });

  describe('borrar los datos', () => {
    it('CRÍTICO: no se borra sin escribir el nombre de la empresa', async () => {
      const efimera = await createTenant('para-borrar-mal');
      // Borrar los datos de la empresa exige credencial reciente desde la Fase 4.
      await reauthenticate(efimera.owner);

      const respuesta = await as(efimera.owner, efimera)
        .post(`/organizations/${efimera.organizationId}/erase`)
        .send({ confirmationName: 'lo que sea' })
        .expect(400);

      expect(JSON.stringify(respuesta.body)).toMatch(/nombre de la empresa/i);

      // Y sigue existiendo.
      await expect(
        prisma.organization.count({ where: { id: efimera.organizationId } }),
      ).resolves.toBe(1);

      await destroyTenant(efimera);
    });

    it('CRÍTICO: un administrador no puede borrar la empresa', async () => {
      const efimera = await createTenant('para-borrar-admin');
      const admin = await addMember(efimera, 'ADMIN', 'admin-borrado');

      await as(admin, efimera)
        .post(`/organizations/${efimera.organizationId}/erase`)
        .send({ confirmationName: 'da igual' })
        .expect(403);

      await destroyTenant(efimera, [admin.userId]);
    });

    it('con el nombre correcto se borra de verdad, y arrastra el contenido', async () => {
      const efimera = await createTenant('para-borrar-bien');
      // Borrar los datos de la empresa exige credencial reciente desde la Fase 4.
      await reauthenticate(efimera.owner);
      const empresa = await prisma.organization.findUniqueOrThrow({
        where: { id: efimera.organizationId },
      });

      // Contenido real, para poder comprobar que la cascada se lo lleva.
      const fuente = await prisma.knowledgeSource.create({
        data: {
          organizationId: efimera.organizationId,
          type: 'FILE_UPLOAD',
          name: 'Fuente',
          connectorKey: 'file_upload_v1',
          createdById: efimera.owner.userId,
          status: 'CONNECTED',
          configEnc: '',
        },
      });
      await prisma.knowledgeItem.create({
        data: {
          organizationId: efimera.organizationId,
          originKnowledgeSourceId: fuente.id,
          currentKnowledgeSourceId: fuente.id,
          title: 'Contrato',
          contentText: 'Contenido del contrato.',
          contentHash: `borrado-${Date.now()}`,
          status: 'INDEXED',
        },
      });

      await as(efimera.owner, efimera)
        .post(`/organizations/${efimera.organizationId}/erase`)
        .send({ confirmationName: empresa.name })
        .expect(200);

      await expect(
        prisma.organization.count({ where: { id: efimera.organizationId } }),
      ).resolves.toBe(0);
      await expect(
        prisma.knowledgeItem.count({
          where: { organizationId: efimera.organizationId },
        }),
      ).resolves.toBe(0);

      // La cuenta de la persona NO se borra: puede pertenecer a otra empresa.
      await expect(
        prisma.user.count({ where: { id: efimera.owner.userId } }),
      ).resolves.toBe(1);

      // CRÍTICO: la traza del borrado sobrevive. Se escribe SIN organización porque
      // `AuditLog` cuelga de ella en cascada y se habría borrado con todo lo demás.
      const traza = await prisma.auditLog.findFirst({
        where: {
          action: 'organization.data_erased',
          targetId: efimera.organizationId,
        },
      });
      expect(traza).not.toBeNull();
      expect(traza?.organizationId).toBeNull();
      expect(traza?.actorId).toBe(efimera.owner.userId);
      expect(traza?.metadata).toMatchObject({ nombre: empresa.name });

      await prisma.user.deleteMany({ where: { id: efimera.owner.userId } });
    });
  });
});

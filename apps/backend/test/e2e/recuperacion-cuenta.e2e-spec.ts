import {
  TEST_PASSWORD,
  addMember,
  as,
  codeFor,
  createTenant,
  destroyTenant,
  enableMfa,
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
import { MAILER, type OutboundEmail } from '../../src/mail/domain/mailer.port';

/**
 * Qué pasa cuando alguien pierde el móvil, los códigos, o la contraseña.
 *
 * ## La pregunta que ordena toda esta suite
 *
 * ¿Existe algún camino por el que tener el correo de una persona, o ser administrador, o ser
 * su propietario, acabe en "estoy dentro de su cuenta"? La respuesta tiene que ser no en los
 * tres casos, y cada uno se comprueba por separado porque cada uno falla de forma distinta.
 *
 * El buzón se sustituye por uno de mentira para poder LEER lo que sale. No es un atajo: es la
 * única forma de comprobar que el aviso se manda de verdad y que no lleva dentro nada que no
 * debería.
 */
describe('recuperar una cuenta sin abrir una puerta trasera', () => {
  const buzon: OutboundEmail[] = [];

  beforeAll(async () => {
    await startTestApp([
      {
        token: MAILER,
        value: {
          send: (email: OutboundEmail) => {
            buzon.push(email);
            return Promise.resolve();
          },
        },
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(() => {
    buzon.length = 0;
  });

  // ── La recuperación por correo NO es un bypass del segundo factor ──────────

  describe('el enlace del correo', () => {
    let actor: TestActor;

    beforeEach(async () => {
      actor = await enableMfa(await registerActor('recuperacion'));
    });

    afterEach(async () => {
      await prisma.user.deleteMany({ where: { id: actor.userId } });
    });

    it('CRÍTICO: cambiar la contraseña por correo NO desactiva el segundo factor', async () => {
      // Es la puerta trasera evidente: si la quitara, quien controlara el buzón entraría con
      // una sola prueba y el segundo factor no protegería del escenario para el que se pone.
      await pedirEnlace(actor.email);
      await usarEnlace(tokenDelUltimoCorreo(buzon), 'contrasena-nueva-1234');

      const usuario = await prisma.user.findUniqueOrThrow({
        where: { id: actor.userId },
      });
      expect(usuario.mfaEnabledAt).not.toBeNull();
      expect(usuario.mfaSecretEnc).not.toBeNull();
    });

    it('CRÍTICO: con el correo y la contraseña nueva, SIGUE sin poder entrar', async () => {
      // La prueba entera del modelo: tener acceso al buzón permite cambiar la contraseña y
      // nada más. Sin el código, no hay sesión.
      await pedirEnlace(actor.email);
      await usarEnlace(tokenDelUltimoCorreo(buzon), 'contrasena-nueva-1234');

      const login = await http()
        .post('/auth/login')
        .send({ email: actor.email, password: 'contrasena-nueva-1234' })
        .expect(201);

      expect(login.body.data.mfaRequired).toBe(true);
      expect(login.body.data.accessToken).toBeUndefined();
    });

    it('con el código además, entra: la recuperación sí funciona', async () => {
      // La contrapartida honesta: esto tiene que seguir sirviendo para quien SÍ es quien dice.
      await pedirEnlace(actor.email);
      await usarEnlace(tokenDelUltimoCorreo(buzon), 'contrasena-nueva-1234');

      const login = await http()
        .post('/auth/login')
        .send({ email: actor.email, password: 'contrasena-nueva-1234' })
        .expect(201);
      const entrada = await http()
        .post('/auth/login/mfa')
        .send({ mfaToken: login.body.data.mfaToken, code: codeFor(actor) })
        .expect(201);

      expect(entrada.body.data.accessToken).toEqual(expect.any(String));
    });

    it('CRÍTICO: y cierra las sesiones abiertas, no solo sus tokens', async () => {
      // Alguien recupera su contraseña justo cuando sospecha que otro entró. Si solo se
      // revocaran los refrescos, el token de acceso del intruso seguiría vivo quince minutos.
      await as(actor).get('/auth/me').expect(200);

      await pedirEnlace(actor.email);
      await usarEnlace(tokenDelUltimoCorreo(buzon), 'contrasena-nueva-1234');

      await as(actor).get('/auth/me').expect(401);
    });
  });

  // ── El propietario rescata a un administrador de su empresa ────────────────

  describe('el propietario retira el segundo factor de un administrador suyo', () => {
    let tenant: TestTenant;
    let administrador: TestActor;

    beforeEach(async () => {
      tenant = await createTenant('rescate');
      administrador = await enableMfa(
        await addMember(tenant, 'ADMIN', 'admin-con-mfa'),
      );
      await reauthenticate(tenant.owner);
    });

    afterEach(async () => {
      await destroyTenant(tenant, [administrador.userId]);
    });

    it('puede, y le avisa por correo', async () => {
      await as(tenant.owner, tenant)
        .post(
          `/organizations/${tenant.organizationId}/members/${administrador.userId}/mfa/remove`,
        )
        .expect(200);

      const usuario = await prisma.user.findUniqueOrThrow({
        where: { id: administrador.userId },
      });
      expect(usuario.mfaEnabledAt).toBeNull();

      const aviso = buzon.find((e) => e.to === administrador.email);
      expect(aviso).toBeDefined();
      expect(aviso!.kind).toBe('mfa-removed');
    });

    it('CRÍTICO: retirarlo NO le da acceso a la cuenta del administrador', async () => {
      // La línea entera del modelo. Después de esto sigue haciendo falta la contraseña de esa
      // persona, que aquí no se lee, no se cambia y no se puede fijar.
      const hashAntes = (
        await prisma.user.findUniqueOrThrow({
          where: { id: administrador.userId },
        })
      ).passwordHash;
      const sesionesAntes = await prisma.authSession.count({
        where: { userId: administrador.userId },
      });

      const respuesta = await as(tenant.owner, tenant)
        .post(
          `/organizations/${tenant.organizationId}/members/${administrador.userId}/mfa/remove`,
        )
        .expect(200);

      // Ni token, ni sesión, ni nada que se le parezca.
      expect(JSON.stringify(respuesta.body)).not.toMatch(
        /accessToken|refreshToken|csrfToken|password/i,
      );
      // La contraseña no se ha tocado.
      const hashDespues = (
        await prisma.user.findUniqueOrThrow({
          where: { id: administrador.userId },
        })
      ).passwordHash;
      expect(hashDespues).toBe(hashAntes);
      // Y la operación no ha creado NI UNA sesión nueva para esa persona. Se compara contra
      // el recuento previo y no contra un número fijo: las que ya había las abrió el propio
      // montaje de la prueba al hacerla entrar, y afirmar "hay exactamente una" convertiría
      // esta garantía en un test frágil que se rompe al cambiar el montaje.
      expect(
        await prisma.authSession.count({
          where: { userId: administrador.userId },
        }),
      ).toBe(sesionesAntes);
    });

    it('y el administrador entra después SOLO con su contraseña', async () => {
      await as(tenant.owner, tenant)
        .post(
          `/organizations/${tenant.organizationId}/members/${administrador.userId}/mfa/remove`,
        )
        .expect(200);

      const login = await http()
        .post('/auth/login')
        .send({ email: administrador.email, password: TEST_PASSWORD })
        .expect(201);
      expect(login.body.data.accessToken).toEqual(expect.any(String));
    });

    it('CRÍTICO: un ADMIN no puede retirárselo a otro ADMIN', async () => {
      const otroAdmin = await addMember(tenant, 'ADMIN', 'admin-atacante');
      await reauthenticate(otroAdmin);

      await as(otroAdmin, tenant)
        .post(
          `/organizations/${tenant.organizationId}/members/${administrador.userId}/mfa/remove`,
        )
        .expect(403);

      const usuario = await prisma.user.findUniqueOrThrow({
        where: { id: administrador.userId },
      });
      expect(usuario.mfaEnabledAt).not.toBeNull();

      await prisma.user.deleteMany({ where: { id: otroAdmin.userId } });
    });

    it('CRÍTICO: el propietario de OTRA empresa no puede', async () => {
      const ajena = await createTenant('rescate-ajeno');
      await reauthenticate(ajena.owner);

      await as(ajena.owner)
        .post(
          `/organizations/${tenant.organizationId}/members/${administrador.userId}/mfa/remove`,
        )
        .expect(403);

      await destroyTenant(ajena);
    });

    it('CRÍTICO: el propietario no puede quitárselo a sí mismo por esta vía', async () => {
      // Si pudiera, su propia sesión abierta sería la forma de quitarse el segundo factor, y
      // el segundo factor dejaría de proteger la sesión desde la que se usa.
      const propietarioConMfa = await enableMfa(tenant.owner);
      await reauthenticate(propietarioConMfa);

      await as(propietarioConMfa, tenant)
        .post(
          `/organizations/${tenant.organizationId}/members/${propietarioConMfa.userId}/mfa/remove`,
        )
        .expect(403);

      const usuario = await prisma.user.findUniqueOrThrow({
        where: { id: tenant.owner.userId },
      });
      expect(usuario.mfaEnabledAt).not.toBeNull();
    });

    it('CRÍTICO: exige reautenticarse', async () => {
      const reciente = await createTenant('rescate-sin-reauth');
      const admin = await enableMfa(await addMember(reciente, 'ADMIN', 'a'));

      await as(reciente.owner, reciente)
        .post(
          `/organizations/${reciente.organizationId}/members/${admin.userId}/mfa/remove`,
        )
        .expect(403);

      await destroyTenant(reciente, [admin.userId]);
    });

    it('queda auditado, en la empresa', async () => {
      await as(tenant.owner, tenant)
        .post(
          `/organizations/${tenant.organizationId}/members/${administrador.userId}/mfa/remove`,
        )
        .expect(200);

      const traza = await prisma.auditLog.findFirstOrThrow({
        where: {
          action: 'mfa.removed_by_owner',
          targetId: administrador.userId,
        },
      });

      // Con organización: la decide quien responde por esa empresa sobre alguien de ella.
      expect(traza.organizationId).toBe(tenant.organizationId);
      expect(traza.actorId).toBe(tenant.owner.userId);
    });
  });

  // ── La plataforma como último recurso ──────────────────────────────────────

  describe('la plataforma retira el segundo factor', () => {
    let admin: TestActor;
    let tenant: TestTenant;
    let afectado: TestActor;

    beforeEach(async () => {
      admin = await registerPlatformAdmin();
      await reauthenticate(admin);
      tenant = await createTenant('ultimo-recurso');
      afectado = await enableMfa(tenant.owner);
    });

    afterEach(async () => {
      await destroyTenant(tenant);
      await prisma.user.deleteMany({ where: { id: admin.userId } });
    });

    it('CRÍTICO: sin motivo, no', async () => {
      await as(admin)
        .post(`/admin/users/${afectado.userId}/mfa/remove`)
        .send({ reason: '' })
        .expect(400);

      const usuario = await prisma.user.findUniqueOrThrow({
        where: { id: afectado.userId },
      });
      expect(usuario.mfaEnabledAt).not.toBeNull();
    });

    it('con motivo, sí', async () => {
      await as(admin)
        .post(`/admin/users/${afectado.userId}/mfa/remove`)
        .send({
          reason: 'Ha perdido el móvil y los códigos; verificado por teléfono.',
        })
        .expect(201);

      const usuario = await prisma.user.findUniqueOrThrow({
        where: { id: afectado.userId },
      });
      expect(usuario.mfaEnabledAt).toBeNull();
      expect(usuario.mfaSecretEnc).toBeNull();
    });

    it('CRÍTICO: NO crea ninguna sesión ni devuelve credenciales', async () => {
      const sesionesAntes = await prisma.authSession.count({
        where: { userId: afectado.userId },
      });

      const respuesta = await as(admin)
        .post(`/admin/users/${afectado.userId}/mfa/remove`)
        .send({
          reason: 'Ha perdido el móvil y los códigos; verificado por teléfono.',
        })
        .expect(201);

      expect(JSON.stringify(respuesta.body)).not.toMatch(
        /accessToken|refreshToken|csrfToken/i,
      );
      expect(
        await prisma.authSession.count({ where: { userId: afectado.userId } }),
      ).toBe(sesionesAntes);
    });

    it('CRÍTICO: NO cambia la contraseña', async () => {
      const antes = (
        await prisma.user.findUniqueOrThrow({ where: { id: afectado.userId } })
      ).passwordHash;

      await as(admin)
        .post(`/admin/users/${afectado.userId}/mfa/remove`)
        .send({
          reason: 'Ha perdido el móvil y los códigos; verificado por teléfono.',
        })
        .expect(201);

      expect(
        (
          await prisma.user.findUniqueOrThrow({
            where: { id: afectado.userId },
          })
        ).passwordHash,
      ).toBe(antes);
    });

    it('CRÍTICO: y sigue sin poder ver el contenido de esa empresa', async () => {
      // Retirar el segundo factor no es una concesión de acceso. Las dos cosas son
      // independientes y siguen siéndolo.
      await as(admin)
        .post(`/admin/users/${afectado.userId}/mfa/remove`)
        .send({
          reason: 'Ha perdido el móvil y los códigos; verificado por teléfono.',
        })
        .expect(201);

      await as(admin)
        .get(`/admin/organizations/${tenant.organizationId}/documents`)
        .expect(403);
      await as(admin)
        .get(`/admin/organizations/${tenant.organizationId}/overview`)
        .expect(403);
    });

    it('avisa a la persona afectada', async () => {
      await as(admin)
        .post(`/admin/users/${afectado.userId}/mfa/remove`)
        .send({
          reason: 'Ha perdido el móvil y los códigos; verificado por teléfono.',
        })
        .expect(201);

      const aviso = buzon.find((e) => e.to === afectado.email);
      expect(aviso).toBeDefined();
      expect(aviso!.body).toContain('Ha perdido el móvil');
      // Y le dice que su contraseña no ha cambiado, que es lo que necesita saber.
      expect(aviso!.body).toMatch(/contraseña/i);
    });

    it('avisa también al propietario de su empresa', async () => {
      const miembro = await enableMfa(await addMember(tenant, 'ADMIN', 'otro'));

      await as(admin)
        .post(`/admin/users/${miembro.userId}/mfa/remove`)
        .send({
          reason: 'Ha perdido el móvil y los códigos; verificado por teléfono.',
        })
        .expect(201);

      const alPropietario = buzon.find((e) => e.to === tenant.owner.email);
      expect(alPropietario).toBeDefined();

      await prisma.user.deleteMany({ where: { id: miembro.userId } });
    });

    it('CRÍTICO: exige reautenticarse', async () => {
      const otroAdmin = await registerPlatformAdmin('sin-reauth');

      await as(otroAdmin)
        .post(`/admin/users/${afectado.userId}/mfa/remove`)
        .send({
          reason: 'Ha perdido el móvil y los códigos; verificado por teléfono.',
        })
        .expect(403);

      await prisma.user.deleteMany({ where: { id: otroAdmin.userId } });
    });

    it('queda auditado como acción de PLATAFORMA, sin organización y con el motivo', async () => {
      const motivo =
        'Ha perdido el móvil y los códigos; verificado por teléfono.';
      await as(admin)
        .post(`/admin/users/${afectado.userId}/mfa/remove`)
        .send({ reason: motivo })
        .expect(201);

      const traza = await prisma.auditLog.findFirstOrThrow({
        where: {
          action: 'platform.user.mfa_removed',
          targetId: afectado.userId,
        },
      });

      // Sin organización: `AuditLog` cuelga de ella en cascada, y lo que hizo la plataforma
      // sobre un cliente es justo lo que hay que conservar si ese cliente se va.
      expect(traza.organizationId).toBeNull();
      expect(traza.actorId).toBe(admin.userId);
      expect(traza.metadata).toMatchObject({ reason: motivo });
      // La empresa afectada viaja en los metadatos.
      expect(JSON.stringify(traza.metadata)).toContain(tenant.organizationId);
    });

    it('y aparece en el listado de auditoría de plataforma', async () => {
      await as(admin)
        .post(`/admin/users/${afectado.userId}/mfa/remove`)
        .send({
          reason: 'Ha perdido el móvil y los códigos; verificado por teléfono.',
        })
        .expect(201);

      const listado = await as(admin)
        .get('/admin/audit?code=platform.user.mfa_removed')
        .expect(200);

      expect(listado.body.data.items.length).toBeGreaterThan(0);
    });
  });
});

async function pedirEnlace(email: string): Promise<void> {
  await http().post('/auth/password-reset/request').send({ email }).expect(202);
}

async function usarEnlace(token: string, password: string): Promise<void> {
  await http()
    .post('/auth/password-reset/confirm')
    .send({ token, password })
    .expect(200);
}

/** El testigo sale del enlace del correo, como lo leería una persona. */
function tokenDelUltimoCorreo(buzon: OutboundEmail[]): string {
  const correo = [...buzon].reverse().find((e) => e.kind === 'password-reset');
  if (!correo) throw new Error('No salió ningún correo de recuperación');

  const match = /token=([a-f0-9]+)/.exec(correo.body);
  if (!match) throw new Error('El correo no llevaba enlace con testigo');
  return match[1];
}

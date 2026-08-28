import {
  TEST_PASSWORD,
  as,
  codeFor,
  createTenant,
  destroyTenant,
  enableMfa,
  expireReauthentication,
  http,
  loginAgain,
  prisma,
  readMfaSecret,
  reauthenticate,
  registerActor,
  startTestApp,
  stopTestApp,
  type TestActor,
} from './harness';
import { totp } from '../../src/auth/domain/totp';

/**
 * La verificación en dos pasos y la reautenticación, sobre Postgres real y por HTTP.
 *
 * ## Qué prueba esto que no puede probar un test unitario
 *
 * Que las rutas llevan puestos los guards. Un `RecentAuthGuard` correcto y una ruta que no lo
 * declara son dos ficheros que pasan sus pruebas por separado y dejan la acción abierta. Lo
 * mismo con el segundo factor: `verifyTotp` puede ser perfecto y `/auth/login` seguir
 * devolviendo una sesión sin pedir el código.
 *
 * Los códigos se calculan aquí con el mismo TOTP que usará la aplicación del móvil. No hay
 * ningún doble: si el algoritmo estuviera mal, estas pruebas fallarían igual que fallaría un
 * cliente real.
 */
describe('verificación en dos pasos y reautenticación', () => {
  let actor: TestActor;

  beforeAll(async () => {
    await startTestApp();
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    actor = await registerActor('mfa');
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: actor.userId } });
  });

  // ── Activar ────────────────────────────────────────────────────────────────

  describe('activarla', () => {
    it('el alta tiene dos pasos y el primero NO activa nada', async () => {
      const setup = await as(actor).post('/auth/mfa/setup').expect(200);

      expect(setup.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(setup.body.data.manualKey).toEqual(expect.any(String));

      // Todavía no está activa: si lo estuviera, quien cierra la pestaña a medias se quedaría
      // fuera de su cuenta con un segundo factor que nunca llegó a configurar.
      const estado = await as(actor).get('/auth/mfa').expect(200);
      expect(estado.body.data.enabled).toBe(false);
      expect(estado.body.data.pendingConfirmation).toBe(true);

      // Y entrar sigue siendo de un solo paso.
      const login = await http()
        .post('/auth/login')
        .send({ email: actor.email, password: TEST_PASSWORD })
        .expect(201);
      expect(login.body.data.accessToken).toEqual(expect.any(String));
    });

    it('un código correcto la activa y entrega los códigos de repuesto', async () => {
      await as(actor).post('/auth/mfa/setup').expect(200);
      const secreto = await readMfaSecret(actor.userId);

      const confirmado = await as(actor)
        .post('/auth/mfa/confirm')
        .send({ code: totp(secreto) })
        .expect(200);

      expect(confirmado.body.data.recoveryCodes).toHaveLength(10);

      const estado = await as(actor).get('/auth/mfa').expect(200);
      expect(estado.body.data.enabled).toBe(true);
      expect(estado.body.data.enabledAt).toEqual(expect.any(String));
      expect(estado.body.data.remainingRecoveryCodes).toBe(10);
    });

    it('CRÍTICO: un código incorrecto NO la activa', async () => {
      await as(actor).post('/auth/mfa/setup').expect(200);

      await as(actor)
        .post('/auth/mfa/confirm')
        .send({ code: '000000' })
        .expect(400);

      const estado = await as(actor).get('/auth/mfa').expect(200);
      expect(estado.body.data.enabled).toBe(false);
    });

    it('CRÍTICO: ni el secreto ni los códigos se pueden volver a consultar', async () => {
      const conMfa = (await enableMfa(actor)) as TestActor & {
        recoveryCodes: string[];
      };
      actor = conMfa;

      const estado = await as(actor).get('/auth/mfa').expect(200);
      const serializado = JSON.stringify(estado.body);

      expect(serializado).not.toContain(conMfa.mfaSecret);
      for (const codigo of conMfa.recoveryCodes) {
        expect(serializado).not.toContain(codigo);
      }
      // Ni siquiera aparece el campo: no hay dónde pedirlos.
      expect(estado.body.data).not.toHaveProperty('recoveryCodes');
      expect(estado.body.data).not.toHaveProperty('secret');
    });
  });

  // ── Entrar ─────────────────────────────────────────────────────────────────

  describe('entrar', () => {
    it('sin segundo factor: la contraseña correcta abre sesión', async () => {
      const login = await http()
        .post('/auth/login')
        .send({ email: actor.email, password: TEST_PASSWORD })
        .expect(201);

      expect(login.body.data.accessToken).toEqual(expect.any(String));
      expect(login.body.data.mfaRequired).toBeUndefined();
    });

    it('CRÍTICO: con segundo factor, la contraseña correcta NO abre sesión', async () => {
      actor = await enableMfa(actor);

      const login = await http()
        .post('/auth/login')
        .send({ email: actor.email, password: TEST_PASSWORD })
        .expect(201);

      expect(login.body.data.mfaRequired).toBe(true);
      expect(login.body.data.accessToken).toBeUndefined();
      expect(login.body.data.user).toBeUndefined();
    });

    it('CRÍTICO: el testigo del segundo paso no vale como token de acceso', async () => {
      // Si valiera, presentarlo saltaría el segundo factor entero y la contraseña volvería a
      // ser suficiente. Va firmado con el mismo secreto, así que solo lo separa la comprobación
      // de `JwtStrategy`.
      actor = await enableMfa(actor);
      const login = await http()
        .post('/auth/login')
        .send({ email: actor.email, password: TEST_PASSWORD })
        .expect(201);

      await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${login.body.data.mfaToken}`)
        .expect(401);
    });

    it('contraseña + código correcto: entra', async () => {
      actor = await enableMfa(actor);

      const login = await http()
        .post('/auth/login')
        .send({ email: actor.email, password: TEST_PASSWORD })
        .expect(201);
      const segundo = await http()
        .post('/auth/login/mfa')
        .send({ mfaToken: login.body.data.mfaToken, code: codeFor(actor) })
        .expect(201);

      expect(segundo.body.data.accessToken).toEqual(expect.any(String));

      await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${segundo.body.data.accessToken}`)
        .expect(200);
    });

    it('CRÍTICO: código incorrecto, no entra', async () => {
      actor = await enableMfa(actor);
      const login = await http()
        .post('/auth/login')
        .send({ email: actor.email, password: TEST_PASSWORD })
        .expect(201);

      await http()
        .post('/auth/login/mfa')
        .send({ mfaToken: login.body.data.mfaToken, code: '000000' })
        .expect(401);
    });

    it('CRÍTICO: un código de hace dos minutos ya no vale', async () => {
      actor = await enableMfa(actor);
      const caducado = totp(actor.mfaSecret!, new Date(Date.now() - 120_000));

      const login = await http()
        .post('/auth/login')
        .send({ email: actor.email, password: TEST_PASSWORD })
        .expect(201);

      await http()
        .post('/auth/login/mfa')
        .send({ mfaToken: login.body.data.mfaToken, code: caducado })
        .expect(401);
    });
  });

  // ── Códigos de repuesto ────────────────────────────────────────────────────

  describe('códigos de repuesto', () => {
    let conCodigos: TestActor & { recoveryCodes: string[] };

    beforeEach(async () => {
      conCodigos = (await enableMfa(actor)) as TestActor & {
        recoveryCodes: string[];
      };
      actor = conCodigos;
    });

    it('uno válido deja entrar', async () => {
      const login = await http()
        .post('/auth/login')
        .send({ email: actor.email, password: TEST_PASSWORD })
        .expect(201);

      const entrada = await http()
        .post('/auth/login/mfa')
        .send({
          mfaToken: login.body.data.mfaToken,
          code: conCodigos.recoveryCodes[0],
        })
        .expect(201);

      expect(entrada.body.data.accessToken).toEqual(expect.any(String));

      // Y queda gastado: nueve.
      const estado = await http()
        .get('/auth/mfa')
        .set('Authorization', `Bearer ${entrada.body.data.accessToken}`)
        .expect(200);
      expect(estado.body.data.remainingRecoveryCodes).toBe(9);
    });

    it('CRÍTICO: el mismo código NO sirve dos veces', async () => {
      const usado = conCodigos.recoveryCodes[1];

      for (const esperado of [201, 401]) {
        const login = await http()
          .post('/auth/login')
          .send({ email: actor.email, password: TEST_PASSWORD })
          .expect(201);

        await http()
          .post('/auth/login/mfa')
          .send({ mfaToken: login.body.data.mfaToken, code: usado })
          .expect(esperado);
      }
    });

    it('CRÍTICO: el código de una persona no sirve para otra', async () => {
      const otra = (await enableMfa(
        await registerActor('mfa-otra'),
      )) as TestActor & { recoveryCodes: string[] };

      const login = await http()
        .post('/auth/login')
        .send({ email: actor.email, password: TEST_PASSWORD })
        .expect(201);

      await http()
        .post('/auth/login/mfa')
        .send({
          mfaToken: login.body.data.mfaToken,
          code: otra.recoveryCodes[0],
        })
        .expect(401);

      await prisma.user.deleteMany({ where: { id: otra.userId } });
    });

    it('regenerar invalida los anteriores', async () => {
      await reauthenticate(actor);
      const nuevos = await as(actor)
        .post('/auth/mfa/recovery-codes')
        .expect(200);

      expect(nuevos.body.data.recoveryCodes).toHaveLength(10);
      expect(nuevos.body.data.recoveryCodes).not.toEqual(
        conCodigos.recoveryCodes,
      );

      // Los viejos ya no sirven: si sobrevivieran, regenerar por sospecha no serviría de nada.
      const login = await http()
        .post('/auth/login')
        .send({ email: actor.email, password: TEST_PASSWORD })
        .expect(201);
      await http()
        .post('/auth/login/mfa')
        .send({
          mfaToken: login.body.data.mfaToken,
          code: conCodigos.recoveryCodes[2],
        })
        .expect(401);
    });
  });

  // ── Límite por cuenta ──────────────────────────────────────────────────────

  it('CRÍTICO: cinco códigos fallidos bloquean LA CUENTA, no la dirección', async () => {
    // El límite por IP no ve un ataque repartido entre mil direcciones, que es exactamente
    // como se ataca un número de seis dígitos. Este contador sí.
    actor = await enableMfa(actor);

    for (let intento = 0; intento < 5; intento += 1) {
      const login = await http()
        .post('/auth/login')
        .send({ email: actor.email, password: TEST_PASSWORD })
        .expect(201);
      await http()
        .post('/auth/login/mfa')
        .send({ mfaToken: login.body.data.mfaToken, code: '111111' })
        .expect(401);
    }

    // Ahora ni el código BUENO entra.
    const login = await http()
      .post('/auth/login')
      .send({ email: actor.email, password: TEST_PASSWORD })
      .expect(201);
    const bloqueado = await http()
      .post('/auth/login/mfa')
      .send({ mfaToken: login.body.data.mfaToken, code: codeFor(actor) })
      .expect(401);

    // Y el mensaje no dice que esté bloqueada: eso confirmaría que la cuenta existe y que
    // tiene segundo factor.
    expect(bloqueado.body.error.message).not.toMatch(/bloque/i);
    expect(bloqueado.body.error.message).not.toMatch(/intent/i);
  });

  // ── Reautenticación ────────────────────────────────────────────────────────

  describe('reautenticarse', () => {
    it('sin segundo factor: la contraseña abre la ventana', async () => {
      const resultado = await as(actor)
        .post('/auth/reauthenticate')
        .send({ password: TEST_PASSWORD })
        .expect(200);

      expect(resultado.body.data.reauthenticatedUntil).toEqual(
        expect.any(String),
      );
      const hasta = new Date(resultado.body.data.reauthenticatedUntil);
      const minutos = (hasta.getTime() - Date.now()) / 60_000;
      expect(minutos).toBeGreaterThan(14);
      expect(minutos).toBeLessThanOrEqual(15);
    });

    it('con segundo factor: el código abre la ventana', async () => {
      actor = await enableMfa(actor);

      await as(actor)
        .post('/auth/reauthenticate')
        .send({ code: codeFor(actor) })
        .expect(200);
    });

    it('CRÍTICO: con segundo factor, la contraseña NO vale', async () => {
      // Es el fallback silencioso que convertiría el segundo factor en decorado justo en las
      // acciones para las que existe. La contraseña vive en el gestor del navegador; el
      // código, en otro dispositivo.
      actor = await enableMfa(actor);

      await as(actor)
        .post('/auth/reauthenticate')
        .send({ password: TEST_PASSWORD })
        .expect(400);
    });

    it('CRÍTICO: la contraseña equivocada no abre nada', async () => {
      await as(actor)
        .post('/auth/reauthenticate')
        .send({ password: 'no-es-esta' })
        .expect(401);

      const me = await as(actor).get('/auth/me').expect(200);
      expect(me.body.data.reauthenticatedUntil).toBeNull();
    });

    it('CRÍTICO: la reautenticación de una sesión NO sirve para otra', async () => {
      // Vive en la sesión y no en la persona: reautenticarse en el portátil no puede abrir la
      // ventana del móvil que alguien dejó abierto en otro sitio.
      await reauthenticate(actor);
      const otraSesion = await loginAgain(actor);

      const me = await as(otraSesion).get('/auth/me').expect(200);
      expect(me.body.data.reauthenticatedUntil).toBeNull();
    });

    it('CRÍTICO: rotar el token de refresco NO pierde la reautenticación', async () => {
      // Es la razón entera de que exista `AuthSession`. Si la ventana colgara del token, se
      // evaporaría en el siguiente refresco sin que nadie se enterara.
      await reauthenticate(actor);
      const antes = await currentSessionId(actor);

      const login = await http()
        .post('/auth/login')
        .send({ email: actor.email, password: TEST_PASSWORD });
      const cookies = login.headers['set-cookie'] as unknown as string[];
      const csrf = leerCookie(cookies, 'bb_csrf');

      // La sesión que se refresca es la NUEVA; lo que se comprueba es que refrescar conserva
      // el identificador, no que lo conserve entre sesiones distintas.
      const refrescado = await http()
        .post('/auth/refresh')
        .set('Cookie', cookies)
        .set('x-csrf-token', csrf)
        .expect(201);

      const sesionTrasRefresco = await prisma.refreshToken.findFirstOrThrow({
        where: { userId: actor.userId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      const sesionDelLogin = await prisma.authSession.findFirstOrThrow({
        where: { userId: actor.userId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      });

      expect(sesionTrasRefresco.sessionId).toBe(sesionDelLogin.id);
      expect(refrescado.body.data.accessToken).toEqual(expect.any(String));
      // Y la sesión original, la que se reautenticó, sigue con su marca.
      const original = await prisma.authSession.findUniqueOrThrow({
        where: { id: antes },
      });
      expect(original.reauthenticatedAt).not.toBeNull();
    });
  });

  // ── La ventana en una acción sensible de verdad ────────────────────────────

  describe('la ventana, sobre una acción sensible real', () => {
    let tenant: Awaited<ReturnType<typeof createTenant>>;

    beforeEach(async () => {
      tenant = await createTenant('ventana');
    });

    afterEach(async () => {
      await destroyTenant(tenant);
    });

    it('CRÍTICO: sin reautenticarse, exportar los datos de la empresa se deniega', async () => {
      await as(tenant.owner, tenant)
        .get(`/organizations/${tenant.organizationId}/export`)
        .expect(403);
    });

    it('reautenticarse lo permite', async () => {
      await reauthenticate(tenant.owner);

      await as(tenant.owner, tenant)
        .get(`/organizations/${tenant.organizationId}/export`)
        .expect(200);
    });

    it('y una segunda acción seguida no vuelve a preguntar', async () => {
      // Es el objetivo declarado: no obligar a introducir la credencial en cada acción
      // consecutiva. Quien revisa permisos hace tres cosas seguidas.
      await reauthenticate(tenant.owner);

      await as(tenant.owner, tenant)
        .get(`/organizations/${tenant.organizationId}/export`)
        .expect(200);
      await as(tenant.owner, tenant)
        .get(`/organizations/${tenant.organizationId}/export`)
        .expect(200);
    });

    it('CRÍTICO: pasada la ventana, vuelve a exigirla', async () => {
      await reauthenticate(tenant.owner);
      await expireReauthentication(tenant.owner);

      await as(tenant.owner, tenant)
        .get(`/organizations/${tenant.organizationId}/export`)
        .expect(403);
    });

    it('CRÍTICO: la reautenticación de OTRA persona no sirve', async () => {
      // Ni siquiera de otro propietario. Va atada a la sesión, y la sesión a la persona.
      const otro = await createTenant('ventana-ajena');
      await reauthenticate(otro.owner);

      await as(tenant.owner, tenant)
        .get(`/organizations/${tenant.organizationId}/export`)
        .expect(403);

      await destroyTenant(otro);
    });

    it('CRÍTICO: la reautenticación de otra empresa no amplía ningún acceso', async () => {
      // Reautenticarse demuestra QUIÉN eres, no a qué perteneces. El aislamiento lo decide
      // `OrgRoleGuard`, que ni mira esto.
      const ajena = await createTenant('ventana-otra-empresa');
      await reauthenticate(ajena.owner);

      const respuesta = await as(ajena.owner)
        .get(`/organizations/${tenant.organizationId}/export`)
        .expect(403);
      expect(respuesta.body.error.message).toMatch(/no perteneces/i);

      await destroyTenant(ajena);
    });

    it('el intento denegado queda registrado', async () => {
      await as(tenant.owner, tenant)
        .get(`/organizations/${tenant.organizationId}/export`)
        .expect(403);

      const traza = await prisma.auditLog.findFirst({
        where: {
          actorId: tenant.owner.userId,
          action: 'auth.sensitive_action_denied',
        },
      });

      expect(traza).not.toBeNull();
      expect(traza!.metadata).toMatchObject({
        sensitiveAction: 'organization.export',
      });
    });
  });
});

async function currentSessionId(actor: TestActor): Promise<string> {
  const session = await prisma.authSession.findFirstOrThrow({
    where: { userId: actor.userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  return session.id;
}

function leerCookie(cookies: string[], nombre: string): string {
  const encontrada = cookies.find((c) => c.startsWith(`${nombre}=`));
  if (!encontrada) throw new Error(`No llegó la cookie ${nombre}`);
  return decodeURIComponent(encontrada.split('=')[1].split(';')[0]);
}

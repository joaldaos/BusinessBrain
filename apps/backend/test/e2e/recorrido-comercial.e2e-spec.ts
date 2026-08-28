import { MembershipRole } from '@businessbrain/database';
import {
  as,
  codeFor,
  expireReauthentication,
  http,
  llmScript,
  prisma,
  readMfaSecret,
  startTestApp,
  stopTestApp,
  type TestActor,
  type TestTenant,
} from './harness';
import { MAILER, type OutboundEmail } from '../../src/mail/domain/mailer.port';
import { totp } from '../../src/auth/domain/totp';
import { FakeGmail } from '../fake-gmail';
import { FakeGoogleDrive } from '../fake-google-drive';
import { GMAIL_PORT } from '../../src/integrations/domain/ports/gmail.port';
import { GOOGLE_DRIVE_PORT } from '../../src/integrations/domain/ports/google-drive.port';

/**
 * El recorrido entero de una PYME, en UN solo test y sin sembrar nada.
 *
 * ## Por qué esto no puede partirse en pruebas independientes
 *
 * Cada paso depende de que el anterior haya ocurrido de verdad. No hay ni un `if (existe X)`:
 * si el análisis no produce conclusión, el paso de la recomendación no encuentra nada y la
 * prueba falla — no se salta. Un recorrido con salidas condicionales pasaría igual con medio
 * producto roto, que es exactamente lo que un test así existe para impedir.
 *
 * Todo va por HTTP: los mismos guards, los mismos pipes y el mismo Postgres que en producción.
 * Lo único sustituido es el modelo de lenguaje —una llamada real no es determinista ni gratis—
 * y el buzón, que se sustituye para poder LEER el enlace de recuperación, no para saltárselo.
 *
 * ## La segunda mitad es la Fase 4
 *
 * De "activar la verificación en dos pasos" en adelante, el recorrido comprueba que la
 * seguridad nueva no rompe nada de lo anterior y que hace lo que dice: que sin el código no se
 * entra, que sin confirmar la identidad no se exporta, que la ventana caduca, y que cambiar la
 * contraseña echa a las demás sesiones y no a la propia.
 */
describe('RECORRIDO COMERCIAL COMPLETO desde base de datos vacía (E2E)', () => {
  const buzon: OutboundEmail[] = [];
  const gmail = new FakeGmail();
  let tenant: TestTenant;

  beforeAll(async () => {
    gmail.putMessage({
      id: 'msg-recorrido',
      body:
        'Cliente mayorista pidiendo un descuento del veinticinco por ciento para el pedido ' +
        'del trimestre. Confirmamos condiciones antes del cierre.',
    });

    await startTestApp([
      {
        // El buzón se sustituye para poder LEER el enlace de recuperación, no para
        // saltárselo: el correo se compone y se manda igual que en producción.
        token: MAILER,
        value: {
          send: (email: OutboundEmail) => {
            buzon.push(email);
            return Promise.resolve();
          },
        },
      },
      // Google no se puede llamar de verdad desde una suite. Todo lo demás del flujo de
      // conexión —el nonce, el estado firmado, la vuelta del consentimiento— es real.
      { token: GMAIL_PORT, value: gmail },
      { token: GOOGLE_DRIVE_PORT, value: new FakeGoogleDrive() },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (tenant) {
      await prisma.organization.deleteMany({
        where: { id: tenant.organizationId },
      });
      await prisma.user.deleteMany({ where: { id: tenant.owner.userId } });
    }
    await stopTestApp();
  });

  it('CRITERIO DE CIERRE: de registrarse a volver a entrar tras cambiar la contraseña', async () => {
    const email = `recorrido-${Date.now()}@test.local`;
    const password = 'contrasena-de-prueba';

    // ── 1. Registrarse ───────────────────────────────────────────────────────
    await http()
      .post('/auth/register')
      .send({ email, password, name: 'Dueña de la PYME' })
      .expect(201);

    const primerLogin = await http()
      .post('/auth/login')
      .send({ email, password })
      .expect(201);

    // Sin segundo factor todavía: entra de un solo paso.
    expect(primerLogin.body.data.accessToken).toEqual(expect.any(String));
    let owner: TestActor = {
      userId: primerLogin.body.data.user.id,
      email,
      password,
      accessToken: primerLogin.body.data.accessToken,
    };

    // ── 2. Crear la organización ─────────────────────────────────────────────
    const creada = await http()
      .post('/organizations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: `Distribuciones ${Date.now()}` })
      .expect(201);
    tenant = { organizationId: creada.body.data.id, owner };

    const trasCrear = await as(owner).get('/auth/me').expect(200);
    expect(trasCrear.body.data.memberships).toEqual([
      expect.objectContaining({
        organizationId: tenant.organizationId,
        role: MembershipRole.OWNER,
      }),
    ]);

    // ── 3. Configurar la IA ──────────────────────────────────────────────────
    const antesDeConfigurar = await as(owner, tenant)
      .get('/ai-configuration')
      .expect(200);
    expect(antesDeConfigurar.body.data.ready).toBe(false);

    await as(owner, tenant)
      .post('/ai-configuration')
      .send({ provider: 'OPENAI', apiKey: 'sk-de-prueba-para-el-recorrido' })
      .expect(201);

    const configurada = await as(owner, tenant)
      .get('/ai-configuration')
      .expect(200);
    expect(configurada.body.data.ready).toBe(true);
    // La clave NO vuelve nunca: es de la empresa y se guarda cifrada.
    expect(JSON.stringify(configurada.body)).not.toContain(
      'sk-de-prueba-para-el-recorrido',
    );

    // ── 4. Subir documentos ──────────────────────────────────────────────────
    // Esta empresa exige fuentes muy fiables. Es un escenario real —una asesoría o una
    // clínica pondrían el listón así— y hace que el análisis produzca una señal DETERMINISTA,
    // sin depender de que el modelo razone bien.
    await as(owner, tenant)
      .patch(`/organizations/${tenant.organizationId}`)
      .send({
        settings: { knowledgeEngine: { confidence: { minimumFloor: 0.95 } } },
      })
      .expect(200);

    const coleccion = await as(owner, tenant)
      .post('/knowledge-collections')
      .send({ name: 'Comercial' })
      .expect(201);

    const fuente = await as(owner, tenant)
      .post('/knowledge-sources')
      .send({
        name: 'Mis documentos',
        type: 'FILE_UPLOAD',
        connectorKey: 'file_upload_v1',
        knowledgeCollectionIds: [coleccion.body.data.id],
      })
      .expect(201);
    const fuenteId = fuente.body.data.id;

    for (const [nombre, texto] of [
      [
        'politica-descuentos.txt',
        'Política comercial. El descuento máximo autorizado en el canal mayorista es del quince por ciento. Ningún comercial puede superarlo sin autorización de dirección.',
      ],
      [
        'informe-trimestre.txt',
        'Informe del trimestre. Se han aplicado descuentos del veinticinco por ciento de forma recurrente en el canal mayorista durante los últimos tres meses.',
      ],
    ]) {
      await http()
        .post(`/knowledge-sources/${fuenteId}/sync`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('x-org-id', tenant.organizationId)
        .attach('file', Buffer.from(texto, 'utf8'), nombre)
        .expect(201);
    }

    const documentos = await as(owner, tenant)
      .get('/knowledge-items')
      .expect(200);
    expect(documentos.body.data).toHaveLength(2);
    expect(
      documentos.body.data.every(
        (d: { status: string }) => d.status === 'INDEXED',
      ),
    ).toBe(true);

    // ── 5. Preguntar, y que la respuesta venga con fuentes ───────────────────
    llmScript.answers = [
      'El máximo autorizado es del quince por ciento en el canal mayorista [1].',
    ];
    const conversacion = await as(owner, tenant)
      .post('/conversations')
      .send({ title: '¿Cuál es nuestro descuento máximo?' })
      .expect(201);
    const respuesta = await as(owner, tenant)
      .post(`/conversations/${conversacion.body.data.id}/messages`)
      .send({ content: '¿Cuál es nuestro descuento máximo?' })
      .expect(201);

    expect(respuesta.body.data.content).toContain('quince por ciento');
    // Sin citas, una respuesta es indistinguible de una invención y no sirve para decidir.
    expect(respuesta.body.data.citations.length).toBeGreaterThan(0);

    // ── 6. Objetivo, análisis, conclusión y recomendación ────────────────────
    await as(owner, tenant)
      .post('/business-objectives')
      .send({
        statement: 'El margen comercial no debe bajar del treinta por ciento.',
      })
      .expect(201);

    llmScript.answers = [
      JSON.stringify({
        insights: [
          {
            subjectIdentity: 'margen-canal-mayorista',
            type: 'RISK',
            summary:
              'Los descuentos aplicados en el canal mayorista superan el máximo autorizado.',
            confidence: 0.86,
            reasoningTrace: { rule: 'contraste entre política e informe' },
          },
        ],
      }),
      // La propuesta que redacta el modelo, con la forma que el producto le exige: qué se ha
      // detectado, por qué importa, qué se gana, qué se arriesga y cómo se haría.
      JSON.stringify({
        title: 'Revisar los descuentos del canal mayorista',
        detected:
          'Los descuentos aplicados superan de forma recurrente el máximo autorizado.',
        justification:
          'Erosiona el margen objetivo declarado por la compañía para el ejercicio.',
        estimatedImpact:
          'Recuperar entre dos y cuatro puntos de margen en el canal.',
        advantages: 'Alinea la práctica comercial con la política escrita.',
        drawbacks: 'Puede tensar la relación con algunos distribuidores.',
        affectedAreas: 'Área comercial y control de márgenes.',
        migrationPlan: 'Comunicar el límite y revisar las ofertas abiertas.',
      }),
    ];

    const analisis = await as(owner, tenant)
      .post('/analysis-runs')
      .send({})
      .expect(201);

    expect(analisis.body.data.status).toBe('SUCCESS');
    expect(analisis.body.data.insightsCreated).toBeGreaterThan(0);
    expect(analisis.body.data.recommendationsProposed).toBeGreaterThan(0);

    // La conclusión existe de verdad y se puede leer.
    const conclusiones = await as(owner, tenant).get('/insights').expect(200);
    expect(conclusiones.body.data.length).toBeGreaterThan(0);

    // ── 7. Decidir sobre la propuesta ────────────────────────────────────────
    const propuestas = await as(owner, tenant)
      .get('/recommendations?status=NEW')
      .expect(200);
    expect(propuestas.body.data.length).toBeGreaterThan(0);

    const propuesta = propuestas.body.data[0];
    await as(owner, tenant)
      .post(`/recommendations/${propuesta.id}/accept`)
      .send({})
      .expect(201);

    const decidida = await as(owner, tenant)
      .get(`/recommendations/${propuesta.id}`)
      .expect(200);
    expect(decidida.body.data.status).toBe('ACCEPTED');
    // Aceptar DECIDE, no ejecuta: no existe ninguna acción automática detrás.
    expect(decidida.body.data).not.toHaveProperty('executedAt');

    // ── 8. Conectar Gmail y traer un correo como conocimiento ────────────────
    const inicio = await as(owner, tenant)
      .get('/integrations/gmail/connect')
      .expect(200);
    const urlAutorizacion: string = inicio.body.data.authorizationUrl;
    // Lleva estado firmado y a dónde volver: es lo que hace que la vuelta del consentimiento
    // no se pueda falsificar. El dominio lo pone el adaptador y no es lo que se verifica aquí.
    expect(urlAutorizacion).toMatch(/^https:\/\//);
    expect(urlAutorizacion).toContain('state=');
    expect(urlAutorizacion).toContain('redirect_uri=');

    // Pedir la URL NO conecta nada: hasta que Google no devuelve el consentimiento con el
    // nonce que salió en la cookie, no hay integración.
    const sinConectar = await as(owner, tenant)
      .get('/integrations')
      .expect(200);
    expect(
      sinConectar.body.data.filter(
        (i: { status: string }) => i.status === 'CONNECTED',
      ),
    ).toEqual([]);

    const cookies = inicio.headers['set-cookie'] as unknown as string[];
    const nonce = cookies.find((c) => c.startsWith('bb_oauth_nonce='))!;
    await http()
      .get('/integrations/gmail/callback')
      .set('Cookie', [nonce])
      .query({
        state: new URL(urlAutorizacion).searchParams.get('state')!,
        code: 'codigo-bueno',
      })
      .expect(302);

    const integraciones = await as(owner, tenant)
      .get('/integrations')
      .expect(200);
    expect(integraciones.body.data[0].status).toBe('CONNECTED');

    const fuenteGmail = await as(owner, tenant)
      .post('/knowledge-sources')
      .send({
        name: 'Correo comercial',
        type: 'GMAIL',
        connectorKey: 'gmail_v1',
        integrationId: integraciones.body.data[0].id,
        // Una etiqueta concreta, no el buzón entero: es la decisión que evita que
        // BusinessBrain se lleve el correo personal de nadie.
        config: {
          integrationId: integraciones.body.data[0].id,
          labelId: 'Label_ventas',
          labelName: 'Ventas',
        },
        knowledgeCollectionIds: [coleccion.body.data.id],
      })
      .expect(201);

    await as(owner, tenant)
      .post(`/knowledge-sources/${fuenteGmail.body.data.id}/sync`)
      .expect(201);

    const conCorreo = await as(owner, tenant)
      .get('/knowledge-items')
      .expect(200);
    expect(conCorreo.body.data.length).toBe(3);

    // ── 9. Recuperar la contraseña por correo ────────────────────────────────
    buzon.length = 0;
    await http()
      .post('/auth/password-reset/request')
      .send({ email })
      .expect(202);

    const correo = buzon.find((e) => e.kind === 'password-reset');
    expect(correo).toBeDefined();
    const testigo = /token=([a-f0-9]+)/.exec(correo!.body)![1];

    const contrasenaRecuperada = 'recuperada-1234';
    await http()
      .post('/auth/password-reset/confirm')
      .send({ token: testigo, password: contrasenaRecuperada })
      .expect(200);

    // Cambiar la contraseña cierra las sesiones abiertas.
    await as(owner).get('/auth/me').expect(401);

    const trasRecuperar = await http()
      .post('/auth/login')
      .send({ email, password: contrasenaRecuperada })
      .expect(201);
    owner = {
      ...owner,
      password: contrasenaRecuperada,
      accessToken: trasRecuperar.body.data.accessToken,
    };
    tenant = { ...tenant, owner };

    // ── 10. Activar la verificación en dos pasos ─────────────────────────────
    const alta = await as(owner).post('/auth/mfa/setup').expect(200);
    expect(alta.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const secreto = await readMfaSecret(owner.userId);
    const confirmacion = await as(owner)
      .post('/auth/mfa/confirm')
      .send({ code: totp(secreto) })
      .expect(200);

    const codigosDeRepuesto: string[] = confirmacion.body.data.recoveryCodes;
    expect(codigosDeRepuesto).toHaveLength(10);
    owner = { ...owner, mfaSecret: secreto };
    tenant = { ...tenant, owner };

    // ── 11. Cerrar sesión, de verdad ─────────────────────────────────────────
    // Antes: con segundo factor activo, la contraseña sola ya NO abre sesión, y por tanto no
    // se fija ninguna cookie.
    const intentoSoloContrasena = await http()
      .post('/auth/login')
      .send({ email, password: contrasenaRecuperada })
      .expect(201);
    expect(intentoSoloContrasena.body.data.mfaRequired).toBe(true);
    expect(intentoSoloContrasena.headers['set-cookie']).toBeUndefined();

    // El cierre lo hace la cookie más el testigo CSRF, como en el navegador.
    const cookiesSesion = trasRecuperar.headers['set-cookie'] as unknown as
      string[] | undefined;
    expect(cookiesSesion).toBeDefined();
    await http()
      .post('/auth/logout')
      .set('Cookie', cookiesSesion!)
      .set('x-csrf-token', trasRecuperar.body.data.csrfToken)
      .expect(201);

    // Y el token de acceso que colgaba de esa sesión deja de valer EN EL ACTO: cerrar sesión
    // revoca la sesión, no solo su token de refresco.
    await as(owner).get('/auth/me').expect(401);

    // ── 12. Volver a entrar con contraseña + código ──────────────────────────
    const paso1 = await http()
      .post('/auth/login')
      .send({ email, password: contrasenaRecuperada })
      .expect(201);
    expect(paso1.body.data.accessToken).toBeUndefined();

    const paso2 = await http()
      .post('/auth/login/mfa')
      .send({ mfaToken: paso1.body.data.mfaToken, code: codeFor(owner) })
      .expect(201);
    owner = { ...owner, accessToken: paso2.body.data.accessToken };
    tenant = { ...tenant, owner };

    const dentro = await as(owner).get('/auth/me').expect(200);
    expect(dentro.body.data.mfaEnabled).toBe(true);
    expect(dentro.body.data.reauthenticatedUntil).toBeNull();

    // ── 13. Una acción sensible, sin haber confirmado la identidad ───────────
    await as(owner, tenant)
      .get(`/organizations/${tenant.organizationId}/export`)
      .expect(403);

    // ── 14. Reautenticarse: con el código, porque tiene segundo factor ───────
    await as(owner)
      .post('/auth/reauthenticate')
      .send({ password: contrasenaRecuperada })
      .expect(400);

    const ventana = await as(owner)
      .post('/auth/reauthenticate')
      .send({ code: codeFor(owner) })
      .expect(200);

    const minutos =
      (new Date(ventana.body.data.reauthenticatedUntil).getTime() -
        Date.now()) /
      60_000;
    expect(minutos).toBeGreaterThan(14);
    expect(minutos).toBeLessThanOrEqual(15);

    // Y ahora la acción sensible pasa, dos veces seguidas sin volver a preguntar.
    const copia = await as(owner, tenant)
      .get(`/organizations/${tenant.organizationId}/export`)
      .expect(200);
    expect(copia.body.data.empresa.id).toBe(tenant.organizationId);
    await as(owner, tenant)
      .get(`/organizations/${tenant.organizationId}/export`)
      .expect(200);

    // ── 15. Pasada la ventana, vuelve a exigirla ─────────────────────────────
    await expireReauthentication(owner);
    await as(owner, tenant)
      .get(`/organizations/${tenant.organizationId}/export`)
      .expect(403);

    // ── 16. Cambiar la contraseña desde dentro ───────────────────────────────
    // Se abre OTRA sesión antes, para poder comprobar que el cambio la echa.
    const otraSesionPaso1 = await http()
      .post('/auth/login')
      .send({ email, password: contrasenaRecuperada })
      .expect(201);
    const otraSesion = await http()
      .post('/auth/login/mfa')
      .send({
        mfaToken: otraSesionPaso1.body.data.mfaToken,
        code: codeFor(owner),
      })
      .expect(201);
    const tokenDeLaOtra = otraSesion.body.data.accessToken;

    await as(owner)
      .post('/auth/reauthenticate')
      .send({ code: codeFor(owner) })
      .expect(200);

    const contrasenaFinal = 'la-definitiva-1234';
    await as(owner)
      .post('/auth/password')
      .send({ newPassword: contrasenaFinal })
      .expect(200);

    // ── 17. La otra sesión ha caído; la propia sigue ─────────────────────────
    await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${tokenDeLaOtra}`)
      .expect(401);
    await as(owner).get('/auth/me').expect(200);

    // ── 18. Volver a entrar con la contraseña nueva, y el código sigue ───────
    await http()
      .post('/auth/login')
      .send({ email, password: contrasenaRecuperada })
      .expect(401);

    const finalPaso1 = await http()
      .post('/auth/login')
      .send({ email, password: contrasenaFinal })
      .expect(201);
    expect(finalPaso1.body.data.mfaRequired).toBe(true);

    const finalPaso2 = await http()
      .post('/auth/login/mfa')
      .send({ mfaToken: finalPaso1.body.data.mfaToken, code: codeFor(owner) })
      .expect(201);

    owner = { ...owner, accessToken: finalPaso2.body.data.accessToken };
    tenant = { ...tenant, owner };

    // Y el producto sigue ahí: la seguridad no ha roto nada de lo de antes.
    const documentosAlFinal = await as(owner, tenant)
      .get('/knowledge-items')
      .expect(200);
    // Los dos ficheros subidos más el correo que trajo la sincronización de Gmail.
    expect(documentosAlFinal.body.data).toHaveLength(3);
    const propuestaAlFinal = await as(owner, tenant)
      .get(`/recommendations/${propuesta.id}`)
      .expect(200);
    expect(propuestaAlFinal.body.data.status).toBe('ACCEPTED');
  }, 180_000);
});

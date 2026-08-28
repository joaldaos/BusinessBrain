import {
  addMember,
  as,
  codeFor,
  createTenant,
  destroyTenant,
  enableMfa,
  http,
  prisma,
  reauthenticate,
  readMfaSecret,
  registerActor,
  startTestApp,
  stopTestApp,
  type TestActor,
  type TestTenant,
} from './harness';
import { totp } from '../../src/auth/domain/totp';

/**
 * El recorrido de quien ADMINISTRA BusinessBrain, en un solo test y desde cero.
 *
 * ## Qué se está demostrando aquí
 *
 * Que la cadena entera —segundo factor obligatorio, entrar, reautenticarse, pedir acceso,
 * usarlo— acaba exactamente donde tiene que acabar: viendo lo que la concesión permite y NADA
 * más. Ni una membresía, ni una ruta de cliente, ni un documento fuera de alcance.
 *
 * Cada paso depende del anterior de verdad. No hay ni una salida condicional: si el segundo
 * factor no bloqueara, el paso siguiente encontraría un 200 donde espera un 403 y la prueba
 * fallaría, no se saltaría.
 */
describe('RECORRIDO DE PLATAFORMA desde base de datos vacía (E2E)', () => {
  let admin: TestActor;
  let tenant: TestTenant;

  beforeAll(async () => {
    await startTestApp();
  }, 60_000);

  afterAll(async () => {
    if (tenant) await destroyTenant(tenant);
    if (admin) await prisma.user.deleteMany({ where: { id: admin.userId } });
    await stopTestApp();
  });

  it('CRITERIO DE CIERRE: de cuenta nueva a leer un documento dentro del alcance concedido', async () => {
    // ── 0. Una empresa cliente con contenido real ────────────────────────────
    tenant = await createTenant('recorrido-plataforma');

    const fuente = await prisma.knowledgeSource.create({
      data: {
        organizationId: tenant.organizationId,
        type: 'FILE_UPLOAD',
        name: 'Contratos',
        connectorKey: 'file_upload_v1',
        createdById: tenant.owner.userId,
        status: 'CONNECTED',
        configEnc: '',
      },
    });
    const documento = await prisma.knowledgeItem.create({
      data: {
        organizationId: tenant.organizationId,
        originKnowledgeSourceId: fuente.id,
        currentKnowledgeSourceId: fuente.id,
        title: 'Contrato con Distribuciones Ruiz',
        contentText: 'El descuento máximo autorizado es del quince por ciento.',
        contentHash: `recorrido-plataforma-${Date.now()}`,
        status: 'INDEXED',
        indexedAt: new Date(),
      },
    });

    // ── 1. La cuenta de administración, recién creada ────────────────────────
    admin = await registerActor('recorrido-admin');
    await prisma.user.update({
      where: { id: admin.userId },
      data: { platformRole: 'SUPERADMIN' },
    });

    // ── 2. Sin segundo factor NO administra nada ─────────────────────────────
    const cerradas: Record<string, number> = {};
    for (const ruta of [
      '/platform/overview',
      '/platform/organizations',
      '/platform/audit',
    ]) {
      cerradas[ruta] = (await as(admin).get(ruta)).status;
    }
    expect(Object.values(cerradas)).toEqual([403, 403, 403]);

    // ── 3. Activarlo: el único camino que le queda abierto ───────────────────
    const alta = await as(admin).post('/auth/mfa/setup').expect(200);
    expect(alta.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const secreto = await readMfaSecret(admin.userId);
    const confirmado = await as(admin)
      .post('/auth/mfa/confirm')
      .send({ code: totp(secreto) })
      .expect(200);
    expect(confirmado.body.data.recoveryCodes).toHaveLength(10);
    admin = { ...admin, mfaSecret: secreto };

    // Y ahora sí administra.
    await as(admin).get('/platform/overview').expect(200);

    // ── 4. Entrar de cero: contraseña + código ───────────────────────────────
    const paso1 = await http()
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(201);
    expect(paso1.body.data.accessToken).toBeUndefined();

    const paso2 = await http()
      .post('/auth/login/mfa')
      .send({ mfaToken: paso1.body.data.mfaToken, code: codeFor(admin) })
      .expect(201);
    admin = { ...admin, accessToken: paso2.body.data.accessToken };

    // ── 5. Consultar la cartera de clientes y las personas ───────────────────
    const cartera = await as(admin).get('/platform/organizations').expect(200);
    const fila = cartera.body.data.items.find(
      (o: { id: string }) => o.id === tenant.organizationId,
    );
    expect(fila).toBeDefined();
    expect(fila.planTier).toBe('FREE');
    expect(fila._count.knowledgeItems).toBe(1);

    const personas = await as(admin).get('/platform/users').expect(200);
    const propietario = personas.body.data.items.find(
      (u: { id: string }) => u.id === tenant.owner.userId,
    );
    expect(propietario).toBeDefined();
    expect(propietario.status).toBe('ACTIVE');

    // ── 6. Y en ninguna de las dos sale un secreto ───────────────────────────
    for (const respuesta of [cartera, personas]) {
      const cuerpo = JSON.stringify(respuesta.body);
      for (const prohibido of [
        'passwordHash',
        'mfaSecretEnc',
        'settings',
        'contentText',
        'quince por ciento',
      ]) {
        expect(cuerpo).not.toContain(prohibido);
      }
    }

    // ── 7. Una acción administrativa, sin haber confirmado la identidad ──────
    await as(admin)
      .post(`/platform/organizations/${tenant.organizationId}/plan`)
      .send({ planTier: 'PRO' })
      .expect(403);

    // ── 6. Reautenticarse, y entonces sí ─────────────────────────────────────
    await as(admin)
      .post('/auth/reauthenticate')
      .send({ code: codeFor(admin) })
      .expect(200);

    await as(admin)
      .post(`/platform/organizations/${tenant.organizationId}/plan`)
      .send({ planTier: 'PRO' })
      .expect(201);

    // ── 8. Bloquear a alguien, y comprobar que deja de entrar ────────────────
    const empleado = await addMember(tenant, 'MEMBER', 'recorrido-empleado');
    await as(empleado).get('/auth/me').expect(200);

    await as(admin).post(`/platform/users/${empleado.userId}/ban`).expect(201);

    // No hace falta revocar sesiones a mano: el estado se comprueba en cada petición.
    await as(empleado).get('/auth/me').expect(401);
    await http()
      .post('/auth/login')
      .send({ email: empleado.email, password: empleado.password })
      .expect(401);

    await as(admin)
      .post(`/platform/users/${empleado.userId}/unban`)
      .expect(201);
    await http()
      .post('/auth/login')
      .send({ email: empleado.email, password: empleado.password })
      .expect(201);

    // ── 9. Y las dos acciones quedan registradas ─────────────────────────────
    const trasBloqueo = await as(admin).get('/platform/audit').expect(200);
    const codigosDelBloqueo = trasBloqueo.body.data.items
      .filter(
        (e: { target: { id: string } }) => e.target.id === empleado.userId,
      )
      .map((e: { code: string }) => e.code);

    expect(codigosDelBloqueo).toEqual(
      expect.arrayContaining([
        'platform.user.banned',
        'platform.user.unbanned',
      ]),
    );

    // ── 10. Pedir acceso, y solo a lo que hace falta ─────────────────────────
    // Sin concesión, ni un contador de esa empresa.
    await as(admin)
      .get(`/platform/organizations/${tenant.organizationId}/overview`)
      .expect(403);

    const metadatos = await as(admin)
      .post(`/platform/organizations/${tenant.organizationId}/access`)
      .send({
        scope: 'METADATA',
        reason: 'El cliente dice que no le entra nada; hay que ver su estado.',
      })
      .expect(201);
    expect(metadatos.body.data.usable).toBe(true);

    // ── 8. Y ve exactamente lo concedido ─────────────────────────────────────
    const panorama = await as(admin)
      .get(`/platform/organizations/${tenant.organizationId}/overview`)
      .expect(200);
    expect(panorama.body.data.counts.documentos).toBe(1);
    // Ni una línea de contenido: la consulta que sirve esta ruta no lo selecciona.
    expect(JSON.stringify(panorama.body)).not.toContain('quince por ciento');

    // Los otros dos alcances siguen cerrados.
    await as(admin)
      .get(`/platform/organizations/${tenant.organizationId}/diagnostics`)
      .expect(403);
    await as(admin)
      .get(`/platform/organizations/${tenant.organizationId}/documents`)
      .expect(403);

    // ── 9. El contenido, solo si lo aprueba el propietario ───────────────────
    const contenido = await as(admin)
      .post(`/platform/organizations/${tenant.organizationId}/access`)
      .send({
        scope: 'CONTENT',
        reason: 'Un documento no se indexa y hay que ver qué tiene dentro.',
      })
      .expect(201);
    expect(contenido.body.data.status).toBe('PENDING');
    expect(contenido.body.data.usable).toBe(false);

    // Pedirlo no lo concede.
    await as(admin)
      .get(`/platform/organizations/${tenant.organizationId}/documents`)
      .expect(403);

    // El cliente lo ve desde su cuenta, con quién, por qué y hasta cuándo.
    await reauthenticate(tenant.owner);
    const historial = await as(tenant.owner, tenant)
      .get(`/organizations/${tenant.organizationId}/platform-access`)
      .expect(200);
    const pendiente = historial.body.data.find(
      (c: { id: string }) => c.id === contenido.body.data.id,
    );
    expect(pendiente).toMatchObject({ scope: 'CONTENT', status: 'PENDING' });
    expect(pendiente.reason).toContain('no se indexa');

    await as(tenant.owner, tenant)
      .post(
        `/organizations/${tenant.organizationId}/platform-access/${contenido.body.data.id}/approve`,
      )
      .expect(201);

    // ── 10. Ahora sí, y documento a documento ────────────────────────────────
    const listado = await as(admin)
      .get(`/platform/organizations/${tenant.organizationId}/documents`)
      .expect(200);
    expect(listado.body.data).toHaveLength(1);
    // El listado da títulos, no texto: el contenido se pide de uno en uno para que la traza
    // registre cuál se leyó.
    expect(JSON.stringify(listado.body)).not.toContain('quince por ciento');

    const leido = await as(admin)
      .get(
        `/platform/organizations/${tenant.organizationId}/documents/${documento.id}`,
      )
      .expect(200);
    expect(leido.body.data.contentText).toContain('quince por ciento');

    // ── 11. Y sigue sin ser miembro de nada ──────────────────────────────────
    const me = await as(admin).get('/auth/me').expect(200);
    expect(me.body.data.memberships).toEqual([]);
    expect(
      await prisma.membership.count({ where: { userId: admin.userId } }),
    ).toBe(0);

    // ── 12. Las rutas de cliente le siguen cerradas ──────────────────────────
    const tenantRoutes: Record<string, number> = {};
    for (const ruta of [
      `/organizations/${tenant.organizationId}`,
      `/organizations/${tenant.organizationId}/knowledge-items`,
      `/organizations/${tenant.organizationId}/export`,
      `/organizations/${tenant.organizationId}/platform-access`,
    ]) {
      tenantRoutes[ruta] = (await as(admin).get(ruta)).status;
    }
    expect(
      Object.entries(tenantRoutes).filter(([, status]) => status === 200),
    ).toEqual([]);

    // ── 12b. La concesión caduca sola, por reloj ─────────────────────────────
    // No hay estado `EXPIRED` persistido: se deriva en cada comprobación. Se envejece la fila
    // en vez de esperar veinticuatro horas — el reloj del proceso no se toca, así que lo que
    // se prueba es la comprobación real y no un tiempo simulado.
    const otraEmpresa = await createTenant('recorrido-caducidad');
    const efimera = await as(admin)
      .post(`/platform/organizations/${otraEmpresa.organizationId}/access`)
      .send({ scope: 'METADATA', reason: 'Comprobando un aviso del cliente.' })
      .expect(201);

    await as(admin)
      .get(`/platform/organizations/${otraEmpresa.organizationId}/overview`)
      .expect(200);

    await prisma.platformAccessGrant.update({
      where: { id: efimera.body.data.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const caducada = await as(admin)
      .get(`/platform/organizations/${otraEmpresa.organizationId}/overview`)
      .expect(403);
    expect(JSON.stringify(caducada.body)).toMatch(/ha caducado/i);

    // Y en "mis accesos" se ve como caducada, sin haber tenido que tocar la fila.
    const mios = await as(admin).get('/platform/access').expect(200);
    const vista = mios.body.data.find(
      (c: { id: string }) => c.id === efimera.body.data.id,
    );
    expect(vista).toMatchObject({ expired: true, usable: false });
    // El estado ALMACENADO sigue siendo ACTIVE: la caducidad no se persiste.
    expect(vista.status).toBe('ACTIVE');

    await destroyTenant(otraEmpresa);

    // ── 13. Retirar la concesión cierra la puerta en el acto ─────────────────
    await as(admin)
      .post(
        `/platform/organizations/${tenant.organizationId}/access/${contenido.body.data.id}/revoke`,
      )
      .expect(201);

    await as(admin)
      .get(
        `/platform/organizations/${tenant.organizationId}/documents/${documento.id}`,
      )
      .expect(403);

    // ── 14. Y todo lo hecho está registrado, en el espacio de plataforma ─────
    const auditoria = await as(admin).get('/platform/audit').expect(200);
    const codigos = auditoria.body.data.items.map(
      (e: { code: string }) => e.code,
    );

    expect(codigos).toEqual(
      expect.arrayContaining([
        'platform.organization.plan_changed',
        'platform.access.requested',
        'platform.access.approved',
        'platform.access.used',
        'platform.access.revoked',
      ]),
    );
    // Ninguna acción de cliente se ha colado en ese listado.
    expect(codigos.filter((c: string) => !c.startsWith('platform.'))).toEqual(
      [],
    );
    // Ni un secreto en toda la traza.
    const serializado = JSON.stringify(auditoria.body);
    expect(serializado).not.toContain(admin.mfaSecret);
    expect(serializado).not.toContain(admin.password);
    expect(serializado).not.toContain('quince por ciento');
  }, 180_000);

  it('CRÍTICO: dos cuentas de plataforma no comparten ni concesión ni ventana', async () => {
    // Lo que impedirá que una identidad distinta —humana o no— reutilice un acceso ajeno el
    // día que exista el asistente.
    const otro = await enableMfa(await registerActor('recorrido-admin-2'));
    await prisma.user.update({
      where: { id: otro.userId },
      data: { platformRole: 'SUPERADMIN' },
    });

    // Ni hereda la reautenticación del primero…
    await as(otro)
      .post(`/platform/organizations/${tenant.organizationId}/access`)
      .send({
        scope: 'METADATA',
        reason: 'Intento de reutilizar acceso ajeno.',
      })
      .expect(403);

    // …ni la concesión que el primero pidió.
    await reauthenticate(otro);
    await as(otro)
      .get(`/platform/organizations/${tenant.organizationId}/overview`)
      .expect(403);

    await prisma.user.deleteMany({ where: { id: otro.userId } });
  });
});

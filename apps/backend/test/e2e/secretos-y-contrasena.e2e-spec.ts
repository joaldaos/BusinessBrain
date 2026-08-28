import {
  TEST_PASSWORD,
  as,
  codeFor,
  enableMfa,
  expireReauthentication,
  http,
  loginAgain,
  prisma,
  reauthenticate,
  registerActor,
  startTestApp,
  stopTestApp,
  type TestActor,
} from './harness';

/**
 * Que ningún secreto salga por ningún lado, y que la contraseña no se cambie sin demostrarlo.
 *
 * ## Cómo se comprueba lo de los registros
 *
 * Se captura TODO lo que la aplicación escribe por salida estándar y error mientras se
 * atraviesa el ciclo completo —activar, entrar, gastar un código de repuesto, regenerar,
 * fallar un código— y después se busca cada secreto dentro. No se inspecciona una llamada
 * concreta al logger: eso solo probaría el sitio que ya se sabe. Aquí, si CUALQUIER parte del
 * sistema escribiera un secreto, aparecería.
 */
describe('secretos que no salen, y contraseña que no se cambia sola', () => {
  let actor: TestActor & { recoveryCodes: string[] };

  beforeAll(async () => {
    await startTestApp();
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: actor.userId } });
  });

  describe('nada de esto llega a los registros ni a la auditoría', () => {
    let escrito: string;

    beforeEach(async () => {
      const capturado: string[] = [];
      const guardar = (chunk: unknown) => {
        capturado.push(String(chunk));
        return true;
      };
      const salida = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(guardar);
      const error = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(guardar);

      try {
        actor = (await enableMfa(
          await registerActor('secretos'),
        )) as TestActor & { recoveryCodes: string[] };

        // El ciclo entero, incluyendo los caminos de error: un fallo suele ser justo donde
        // alguien registra "el código recibido fue X" para depurar.
        const primero = await http()
          .post('/auth/login')
          .send({ email: actor.email, password: TEST_PASSWORD });
        await http()
          .post('/auth/login/mfa')
          .send({ mfaToken: primero.body.data.mfaToken, code: '000000' });
        await http().post('/auth/login/mfa').send({
          mfaToken: primero.body.data.mfaToken,
          code: actor.recoveryCodes[0],
        });

        await reauthenticate(actor);
        await as(actor).post('/auth/mfa/recovery-codes').expect(200);
      } finally {
        salida.mockRestore();
        error.mockRestore();
      }

      escrito = capturado.join('\n');
    });

    it('CRÍTICO: el secreto TOTP no aparece en ningún registro', () => {
      expect(escrito).not.toContain(actor.mfaSecret);
    });

    it('CRÍTICO: ningún código de recuperación aparece en ningún registro', () => {
      for (const codigo of actor.recoveryCodes) {
        expect(escrito).not.toContain(codigo);
      }
    });

    it('CRÍTICO: la contraseña tampoco', () => {
      expect(escrito).not.toContain(TEST_PASSWORD);
    });

    it('CRÍTICO: ni el secreto ni los códigos entran en la auditoría', async () => {
      const trazas = await prisma.auditLog.findMany({
        where: { actorId: actor.userId },
      });
      const serializado = JSON.stringify(trazas);

      expect(trazas.length).toBeGreaterThan(0);
      expect(serializado).not.toContain(actor.mfaSecret);
      for (const codigo of actor.recoveryCodes) {
        expect(serializado).not.toContain(codigo);
      }
      expect(serializado).not.toContain(TEST_PASSWORD);
    });

    it('pero la auditoría SÍ registra lo que pasó', async () => {
      // La contrapartida: si tachar secretos dejara la traza vacía, no habría auditoría que
      // proteger. Estas son las acciones que el ciclo de arriba tenía que dejar escritas.
      const acciones = (
        await prisma.auditLog.findMany({ where: { actorId: actor.userId } })
      ).map((t) => t.action);

      expect(acciones).toEqual(
        expect.arrayContaining([
          'mfa.enabled',
          'mfa.code_failed',
          'mfa.recovery_code_used',
          'auth.reauthenticated',
          'mfa.recovery_codes_regenerated',
        ]),
      );
    });

    it('CRÍTICO: el secreto se guarda CIFRADO, no en claro', async () => {
      const usuario = await prisma.user.findUniqueOrThrow({
        where: { id: actor.userId },
      });

      expect(usuario.mfaSecretEnc).not.toBeNull();
      expect(usuario.mfaSecretEnc).not.toContain(actor.mfaSecret!);
      // El formato del `EncryptionService`: iv:authTag:ciphertext, todo en base64.
      expect(usuario.mfaSecretEnc!.split(':')).toHaveLength(3);
    });

    it('CRÍTICO: los códigos de recuperación se guardan con hash, no en claro', async () => {
      const guardados = await prisma.mfaRecoveryCode.findMany({
        where: { userId: actor.userId },
      });
      const serializado = JSON.stringify(guardados);

      expect(guardados.length).toBeGreaterThan(0);
      for (const codigo of actor.recoveryCodes) {
        expect(serializado).not.toContain(codigo);
      }
    });
  });

  describe('cambiar la contraseña desde dentro', () => {
    beforeEach(async () => {
      actor = (await registerActor('cambio')) as TestActor & {
        recoveryCodes: string[];
      };
    });

    it('CRÍTICO: no basta con que el token esté vivo', async () => {
      // Una sesión de hace tres semanas no puede cambiar la contraseña de nadie.
      await as(actor)
        .post('/auth/password')
        .send({ newPassword: 'otra-contrasena-1234' })
        .expect(403);

      // Y no se ha cambiado.
      await http()
        .post('/auth/login')
        .send({ email: actor.email, password: TEST_PASSWORD })
        .expect(201);
    });

    it('reautenticándose, sí', async () => {
      await reauthenticate(actor);

      await as(actor)
        .post('/auth/password')
        .send({ newPassword: 'otra-contrasena-1234' })
        .expect(200);

      await http()
        .post('/auth/login')
        .send({ email: actor.email, password: 'otra-contrasena-1234' })
        .expect(201);
      await http()
        .post('/auth/login')
        .send({ email: actor.email, password: TEST_PASSWORD })
        .expect(401);
    });

    it('CRÍTICO: pasada la ventana, vuelve a exigirla', async () => {
      await reauthenticate(actor);
      await expireReauthentication(actor);

      await as(actor)
        .post('/auth/password')
        .send({ newPassword: 'otra-contrasena-1234' })
        .expect(403);
    });

    it('CRÍTICO: revoca las OTRAS sesiones y conserva la actual', async () => {
      // Alguien cambia la contraseña justo cuando sospecha que otro entró: las demás tienen
      // que caer. La suya no, porque cerrarle la sesión a quien acaba de demostrar quién es,
      // en la pantalla en la que está, sería castigar la acción correcta.
      const otraSesion = await loginAgain(actor);
      await reauthenticate(actor);

      await as(actor)
        .post('/auth/password')
        .send({ newPassword: 'otra-contrasena-1234' })
        .expect(200);

      await as(otraSesion).get('/auth/me').expect(401);
      await as(actor).get('/auth/me').expect(200);
    });

    it('CRÍTICO: con segundo factor, la reautenticación exige el código', async () => {
      const conMfa = await enableMfa(actor);
      actor = conMfa as TestActor & { recoveryCodes: string[] };

      // La contraseña ya no abre la ventana…
      await as(actor)
        .post('/auth/reauthenticate')
        .send({ password: TEST_PASSWORD })
        .expect(400);
      await as(actor)
        .post('/auth/password')
        .send({ newPassword: 'otra-contrasena-1234' })
        .expect(403);

      // …y el código sí.
      await as(actor)
        .post('/auth/reauthenticate')
        .send({ code: codeFor(actor) })
        .expect(200);
      await as(actor)
        .post('/auth/password')
        .send({ newPassword: 'otra-contrasena-1234' })
        .expect(200);
    });

    it('CRÍTICO: cambiar la contraseña NO desactiva el segundo factor', async () => {
      actor = (await enableMfa(actor)) as TestActor & {
        recoveryCodes: string[];
      };
      await reauthenticate(actor);

      await as(actor)
        .post('/auth/password')
        .send({ newPassword: 'otra-contrasena-1234' })
        .expect(200);

      const login = await http()
        .post('/auth/login')
        .send({ email: actor.email, password: 'otra-contrasena-1234' })
        .expect(201);
      expect(login.body.data.mfaRequired).toBe(true);
    });

    it('queda auditado, sin la contraseña', async () => {
      await reauthenticate(actor);
      await as(actor)
        .post('/auth/password')
        .send({ newPassword: 'otra-contrasena-1234' })
        .expect(200);

      const traza = await prisma.auditLog.findFirstOrThrow({
        where: { actorId: actor.userId, action: 'password.changed' },
      });

      expect(JSON.stringify(traza)).not.toContain('otra-contrasena-1234');
      expect(JSON.stringify(traza)).not.toContain(TEST_PASSWORD);
    });
  });
});

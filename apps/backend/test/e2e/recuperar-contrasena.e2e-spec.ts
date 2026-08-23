import { MAILER, type OutboundEmail } from '../../src/mail/domain/mailer.port';
import { http, prisma, startTestApp, stopTestApp } from './harness';

/**
 * Una PYME que ha olvidado su contraseña vuelve a entrar sola (E2E).
 *
 * Era el segundo bloqueante para vender: hasta ahora, quien perdía la contraseña solo podía
 * ser rescatado entrando a mano en Postgres. Con cinco pilotos eso pasa la primera semana, y
 * es exactamente el tipo de "estado que requiere tocar la base de datos" que no puede existir.
 *
 * Se prueba por HTTP y de punta a punta porque el flujo cruza cuatro superficies —petición,
 * correo, cambio de contraseña y sesión— y ninguna prueba de una sola de ellas demostraría que
 * la persona vuelve a entrar.
 *
 * El correo se recoge con un doble del PUERTO de correo. No es un atajo: es el mismo puerto
 * que usa producción, y recogerlo así es lo que permite que el testigo no viaje NUNCA en una
 * respuesta HTTP, ni siquiera "solo en pruebas".
 */
describe('Recuperar la contraseña (E2E)', () => {
  const buzon: OutboundEmail[] = [];
  const unique = Math.random().toString(36).slice(2, 8);
  const email = `olvidadiza-${unique}@e2e.local`;
  const passwordOriginal = 'contrasena-de-prueba';
  const passwordNueva = 'mi-contrasena-nueva';
  let userId: string;

  beforeAll(async () => {
    await startTestApp([
      {
        token: MAILER,
        value: {
          send: (correo: OutboundEmail) => {
            buzon.push(correo);
            return Promise.resolve();
          },
        },
      },
    ]);

    const registrada = await http()
      .post('/auth/register')
      .send({ email, password: passwordOriginal, name: 'Ana' })
      .expect(201);
    userId = (registrada.body as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await stopTestApp();
  });

  beforeEach(() => {
    buzon.length = 0;
  });

  const pedirRecuperacion = (correo: string) =>
    http().post('/auth/password-reset/request').send({ email: correo });

  const testigoDelUltimoCorreo = (): string => {
    const ultimo = buzon.at(-1);
    if (!ultimo) throw new Error('No se mandó ningún correo');
    const encontrado = /token=([a-f0-9]+)/.exec(ultimo.body);
    if (!encontrado) throw new Error('El correo no traía enlace');
    return encontrado[1];
  };

  const login = (password: string) =>
    http().post('/auth/login').send({ email, password });

  describe('pedir el enlace', () => {
    it('manda un correo con el enlace a quien tiene cuenta', async () => {
      await pedirRecuperacion(email).expect(202);

      expect(buzon).toHaveLength(1);
      expect(buzon[0].to).toBe(email);
      expect(buzon[0].body).toContain('/restablecer?token=');
    });

    it('CRÍTICO: el testigo NO sale en la respuesta', async () => {
      // Es la razón entera de que el correo exista. Si volviera aquí, cualquiera podría pedir
      // la recuperación de otra persona y leer el enlace en la respuesta.
      const respuesta = await pedirRecuperacion(email).expect(202);
      const testigo = testigoDelUltimoCorreo();

      expect(JSON.stringify(respuesta.body)).not.toContain(testigo);
      expect(respuesta.body).toEqual({ data: { success: true } });
    });

    it('CRÍTICO: un correo que no existe responde EXACTAMENTE lo mismo', async () => {
      // Sin esto, esta pantalla es un buscador de clientes: se prueban direcciones y se
      // apuntan las que existen.
      const conocido = await pedirRecuperacion(email).expect(202);
      const desconocido = await pedirRecuperacion(
        `no-existe-${unique}@e2e.local`,
      ).expect(202);

      expect(desconocido.body).toEqual(conocido.body);
      expect(desconocido.status).toBe(conocido.status);
    });

    it('a un correo que no existe no se le manda nada', async () => {
      await pedirRecuperacion(`tampoco-${unique}@e2e.local`).expect(202);

      expect(buzon).toHaveLength(0);
    });

    it('CRÍTICO: el testigo se guarda cifrado, nunca en claro', async () => {
      await pedirRecuperacion(email).expect(202);
      const testigo = testigoDelUltimoCorreo();

      const guardado = await prisma.passwordResetToken.findFirst({
        where: { userId, usedAt: null },
      });

      expect(guardado).not.toBeNull();
      expect(guardado?.tokenHash).not.toBe(testigo);
      // Y buscar por el testigo en claro no encuentra nada: quien leyera la tabla no podría
      // componer ningún enlace.
      await expect(
        prisma.passwordResetToken.findFirst({ where: { tokenHash: testigo } }),
      ).resolves.toBeNull();
    });

    it('pedirlo otra vez invalida el enlace anterior', async () => {
      await pedirRecuperacion(email).expect(202);
      const primero = testigoDelUltimoCorreo();

      await pedirRecuperacion(email).expect(202);
      const segundo = testigoDelUltimoCorreo();
      expect(segundo).not.toBe(primero);

      // Solo vale el que la persona tiene delante.
      await http()
        .post('/auth/password-reset/confirm')
        .send({ token: primero, password: 'da-igual-cual-sea' })
        .expect(400);
    });
  });

  describe('usar el enlace', () => {
    it('la persona entra con la contraseña nueva y no con la vieja', async () => {
      await pedirRecuperacion(email).expect(202);
      const testigo = testigoDelUltimoCorreo();

      await http()
        .post('/auth/password-reset/confirm')
        .send({ token: testigo, password: passwordNueva })
        .expect(200);

      await login(passwordNueva).expect(201);
      await login(passwordOriginal).expect(401);
    });

    it('CRÍTICO: el mismo enlace no sirve dos veces', async () => {
      await pedirRecuperacion(email).expect(202);
      const testigo = testigoDelUltimoCorreo();

      await http()
        .post('/auth/password-reset/confirm')
        .send({ token: testigo, password: 'primera-vez-vale-1' })
        .expect(200);

      await http()
        .post('/auth/password-reset/confirm')
        .send({ token: testigo, password: 'segunda-vez-no-2' })
        .expect(400);

      // Y la contraseña sigue siendo la del primer uso.
      await login('primera-vez-vale-1').expect(201);
    });

    it('CRÍTICO: un enlace caducado no sirve', async () => {
      await pedirRecuperacion(email).expect(202);
      const testigo = testigoDelUltimoCorreo();

      // Se envejece la fila en vez de esperar una hora.
      await prisma.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await http()
        .post('/auth/password-reset/confirm')
        .send({ token: testigo, password: 'no-deberia-entrar-3' })
        .expect(400);

      await login('no-deberia-entrar-3').expect(401);
    });

    it('CRÍTICO: caducado, usado e inventado dan el MISMO mensaje', async () => {
      // Distinguirlos ayudaría a quien prueba testigos al azar a saber cuándo acierta.
      await pedirRecuperacion(email).expect(202);
      const testigo = testigoDelUltimoCorreo();
      await http()
        .post('/auth/password-reset/confirm')
        .send({ token: testigo, password: 'una-contrasena-4' })
        .expect(200);

      const usado = await http()
        .post('/auth/password-reset/confirm')
        .send({ token: testigo, password: 'otra-contrasena-5' })
        .expect(400);

      const inventado = await http()
        .post('/auth/password-reset/confirm')
        .send({ token: 'a'.repeat(64), password: 'otra-contrasena-5' })
        .expect(400);

      expect(mensajeDe(inventado)).toBe(mensajeDe(usado));
    });

    it('el mensaje de error se entiende sin ser informático', async () => {
      const respuesta = await http()
        .post('/auth/password-reset/confirm')
        .send({ token: 'b'.repeat(64), password: 'una-contrasena-6' })
        .expect(400);

      const mensaje = mensajeDe(respuesta);
      expect(mensaje).toMatch(/enlace/i);
      expect(mensaje).toMatch(/pide uno nuevo/i);
      // Nada de vocabulario interno.
      expect(mensaje).not.toMatch(
        /token|hash|prisma|null|undefined|PasswordResetToken/i,
      );
    });

    it('una contraseña demasiado corta se rechaza igual que al registrarse', async () => {
      await pedirRecuperacion(email).expect(202);
      const testigo = testigoDelUltimoCorreo();

      // Si aquí fuera más laxo, recuperar la contraseña sería la forma de saltarse la regla.
      await http()
        .post('/auth/password-reset/confirm')
        .send({ token: testigo, password: 'corta' })
        .expect(400);
    });
  });

  describe('sesiones abiertas', () => {
    it('CRÍTICO: cambiar la contraseña cierra las sesiones que ya estaban abiertas', async () => {
      // Se recupera la contraseña justamente cuando se sospecha que otro entró. Si su sesión
      // siguiera viva, la recuperación no habría servido de nada.
      await login('una-contrasena-4').expect(201);
      const vivasAntes = await prisma.refreshToken.count({
        where: { userId, revokedAt: null },
      });
      expect(vivasAntes).toBeGreaterThan(0);

      await pedirRecuperacion(email).expect(202);
      await http()
        .post('/auth/password-reset/confirm')
        .send({ token: testigoDelUltimoCorreo(), password: 'recuperada-7' })
        .expect(200);

      await expect(
        prisma.refreshToken.count({ where: { userId, revokedAt: null } }),
      ).resolves.toBe(0);
    });
  });
});

/**
 * El mensaje que ve la persona.
 *
 * El filtro global responde `{ statusCode, error, timestamp }`, donde `error` es una cadena o
 * el cuerpo de la excepción. Se normaliza aquí para que la comprobación mire el texto real y
 * no una cadena vacía — que era lo que ocurría antes, y hacía pasar la prueba sin comprobar
 * nada.
 */
function mensajeDe(response: { body: unknown }): string {
  const { error } = response.body as { error?: unknown };
  if (typeof error === 'string') return error;

  const message = (error as { message?: unknown })?.message;
  if (Array.isArray(message)) return message.join(' ');
  return typeof message === 'string' ? message : '';
}

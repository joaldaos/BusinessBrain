import { RATE_LIMITS } from '../../src/common/http/rate-limits';
import { http, prisma, startTestApp, stopTestApp } from './harness';

/**
 * Los límites de peticiones, con los números de PRODUCCIÓN (E2E).
 *
 * El resto de suites arrancan con el multiplicador muy alto para no cortarse a sí mismas —
 * decenas de registros desde la misma dirección. Esta lo baja a uno a propósito: es la única
 * que puede demostrar que los números reales funcionan y que el mensaje que ve una persona se
 * entiende.
 *
 * Se prueba por HTTP porque lo que se verifica es el guard enchufado a la ruta. Un test
 * unitario del catálogo comprueba que los números son sensatos; solo esto comprueba que
 * alguien los está aplicando.
 */
describe('Límites de peticiones (E2E)', () => {
  const anterior = process.env.RATE_LIMIT_MULTIPLIER;
  const creados: string[] = [];

  beforeAll(async () => {
    // Números de producción, sin holgura: es lo que esta suite existe para comprobar.
    process.env.RATE_LIMIT_MULTIPLIER = '1';
    await startTestApp();
  });

  afterAll(async () => {
    process.env.RATE_LIMIT_MULTIPLIER = anterior;
    await prisma.user.deleteMany({ where: { id: { in: creados } } });
    await stopTestApp();
  });

  const unique = () => Math.random().toString(36).slice(2, 10);

  /** El texto que ve la persona, sea cual sea la forma del error. */
  const mensajeDe = (response: { body: unknown }): string => {
    const { error } = response.body as { error?: unknown };
    if (typeof error === 'string') return error;
    const message = (error as { message?: unknown })?.message;
    return typeof message === 'string' ? message : '';
  };

  describe('entrar', () => {
    it('CRÍTICO: probar contraseñas se corta', async () => {
      const email = `fuerza-bruta-${unique()}@e2e.local`;

      // Cuenta real: si el límite dependiera de que el correo existe, un atacante sabría por
      // el comportamiento cuáles existen.
      const registrada = await http()
        .post('/auth/register')
        .send({ email, password: 'contrasena-de-prueba', name: 'Víctima' })
        .expect(201);
      creados.push((registrada.body as { data: { id: string } }).data.id);

      const codigos: number[] = [];
      for (
        let intento = 0;
        intento < RATE_LIMITS.login.limit + 3;
        intento += 1
      ) {
        const respuesta = await http()
          .post('/auth/login')
          .send({ email, password: `probando-${intento}` });
        codigos.push(respuesta.status);
      }

      expect(codigos).toContain(429);
      // Y se corta ANTES de agotar todos los intentos, no al final.
      expect(codigos.indexOf(429)).toBeLessThanOrEqual(RATE_LIMITS.login.limit);
    });

    it('el mensaje se entiende sin ser informático', async () => {
      const respuesta = await http()
        .post('/auth/login')
        .send({ email: `da-igual-${unique()}@e2e.local`, password: 'x' });

      // Ya se llegó al límite en el test anterior: esta petición cae en el mismo cubo.
      expect(respuesta.status).toBe(429);

      const mensaje = mensajeDe(respuesta);
      expect(mensaje).toMatch(/demasiados intentos/i);
      expect(mensaje).toMatch(/espera/i);
      expect(mensaje).not.toMatch(/Throttler|Too Many Requests|Exception/i);
    });

    it('CRÍTICO: no dice POR QUÉ se ha llegado al límite', async () => {
      // Distinguir "has fallado la contraseña muchas veces" de "hay demasiadas peticiones
      // desde tu red" le confirmaría a quien prueba contraseñas que va por buen camino.
      const respuesta = await http()
        .post('/auth/login')
        .send({ email: `otro-${unique()}@e2e.local`, password: 'x' });

      expect(mensajeDe(respuesta)).not.toMatch(
        /contraseñ|usuario|cuenta|correo/i,
      );
    });
  });

  describe('cada puerta tiene su propio contador', () => {
    it('CRÍTICO: haber agotado los intentos de entrar no impide crear una cuenta', async () => {
      // El catálogo aplica todos los límites a toda ruta protegida salvo que se descarten.
      // Sin el decorador que los descarta, agotar "entrar" cerraría también el registro y
      // nadie entendería por qué.
      const registrada = await http()
        .post('/auth/register')
        .send({
          email: `sigue-abierto-${unique()}@e2e.local`,
          password: 'contrasena-de-prueba',
          name: 'Otra',
        })
        .expect(201);

      creados.push((registrada.body as { data: { id: string } }).data.id);
    });
  });

  describe('pedir la recuperación', () => {
    it('CRÍTICO: no se puede inundar el buzón de alguien', async () => {
      const email = `inundado-${unique()}@e2e.local`;

      const codigos: number[] = [];
      for (
        let intento = 0;
        intento < RATE_LIMITS.passwordResetRequest.limit + 2;
        intento += 1
      ) {
        const respuesta = await http()
          .post('/auth/password-reset/request')
          .send({ email });
        codigos.push(respuesta.status);
      }

      expect(codigos).toContain(429);
    });
  });
});

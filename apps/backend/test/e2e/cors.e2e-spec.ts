import { http, startTestApp, stopTestApp } from './harness';

/**
 * Qué webs pueden hablar con la API desde el navegador de un cliente (E2E).
 *
 * Se levanta la aplicación en modo PRODUCCIÓN a propósito: es el único modo donde la política
 * es estricta, y comprobarla en modo desarrollo —donde cualquier bucle local vale— no
 * demostraría nada.
 *
 * Se verifica por HTTP porque lo que importa son CABECERAS de respuesta. Un test unitario
 * comprueba que la política se calcula bien; solo esto comprueba que además está enchufada.
 */
describe('Origen cruzado (E2E)', () => {
  const AUTORIZADO = 'https://app.empresa.com';
  const AJENO = 'https://atacante.io';

  beforeAll(async () => {
    await startTestApp([], {
      isProduction: true,
      frontendUrl: AUTORIZADO,
    });
  });

  afterAll(async () => {
    await stopTestApp();
  });

  /** La cabecera que autoriza al navegador a ENTREGAR la respuesta al script que la pidió. */
  const allowOrigin = (
    headers: Record<string, string | string[] | undefined>,
  ) => headers['access-control-allow-origin'];

  describe('comprobación previa', () => {
    it('el origen autorizado recibe permiso', async () => {
      const response = await http()
        .options('/auth/login')
        .set('Origin', AUTORIZADO)
        .set('Access-Control-Request-Method', 'POST');

      expect(allowOrigin(response.headers)).toBe(AUTORIZADO);
    });

    it('CRÍTICO: cualquier otro origen no recibe permiso', async () => {
      const response = await http()
        .options('/auth/login')
        .set('Origin', AJENO)
        .set('Access-Control-Request-Method', 'POST');

      expect(allowOrigin(response.headers)).toBeUndefined();
    });

    it('CRÍTICO: un origen que solo PARECE el autorizado no cuela', async () => {
      // `app.empresa.com.atacante.io` es un dominio del atacante que empieza igual. Una
      // comparación por prefijo lo aceptaría.
      const response = await http()
        .options('/auth/login')
        .set('Origin', 'https://app.empresa.com.atacante.io')
        .set('Access-Control-Request-Method', 'POST');

      expect(allowOrigin(response.headers)).toBeUndefined();
    });

    it('CRÍTICO: en producción no se acepta el bucle local', async () => {
      const response = await http()
        .options('/auth/login')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST');

      expect(allowOrigin(response.headers)).toBeUndefined();
    });
  });

  describe('credenciales', () => {
    it('el origen autorizado puede enviar cookies', async () => {
      const response = await http()
        .options('/auth/refresh')
        .set('Origin', AUTORIZADO)
        .set('Access-Control-Request-Method', 'POST');

      expect(allowOrigin(response.headers)).toBe(AUTORIZADO);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('CRÍTICO: desde otro origen no se autoriza el envío de credenciales', async () => {
      // Sin `Allow-Origin` la respuesta es inalcanzable para el script del atacante, y sin
      // `Allow-Credentials` el navegador no le habría dejado adjuntar la cookie de todas
      // formas. Se comprueban las dos: una sola sería una única línea de defensa.
      const response = await http()
        .options('/auth/refresh')
        .set('Origin', AJENO)
        .set('Access-Control-Request-Method', 'POST');

      expect(allowOrigin(response.headers)).toBeUndefined();
      expect(
        response.headers['access-control-allow-credentials'],
      ).toBeUndefined();
    });
  });

  describe('petición real', () => {
    it('CRÍTICO: la respuesta a un origen ajeno no es legible por ese origen', async () => {
      // El servidor procesa la petición —eso es CORS, no un cortafuegos— pero sin la cabecera
      // el navegador no deja que el script de `atacante.io` lea el cuerpo. Comprobar esto
      // sobre una petición REAL y no solo sobre la previa importa: son dos caminos distintos
      // dentro del middleware.
      const response = await http()
        .post('/auth/login')
        .set('Origin', AJENO)
        .send({ email: 'quien-sea@e2e.local', password: 'lo-que-sea' });

      expect(allowOrigin(response.headers)).toBeUndefined();
    });

    it('la respuesta al origen autorizado sí lo es', async () => {
      const response = await http()
        .post('/auth/login')
        .set('Origin', AUTORIZADO)
        .send({ email: 'quien-sea@e2e.local', password: 'lo-que-sea' });

      expect(allowOrigin(response.headers)).toBe(AUTORIZADO);
    });
  });
});

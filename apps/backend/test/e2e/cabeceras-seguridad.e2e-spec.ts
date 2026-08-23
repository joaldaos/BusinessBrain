import { http, startTestApp, stopTestApp } from './harness';

/**
 * Las cabeceras de seguridad de la API (E2E).
 *
 * Son invisibles y silenciosas: si un día alguien las quita, nada se rompe y nadie se entera
 * hasta que hay un incidente. Por eso se comprueban por HTTP, sobre la aplicación real.
 *
 * Se arranca en modo producción porque una de ellas —la que obliga a HTTPS— solo existe ahí.
 */
describe('Cabeceras de seguridad (E2E)', () => {
  beforeAll(async () => {
    await startTestApp([], {
      isProduction: true,
      frontendUrl: 'https://app.empresa.com',
    });
  });

  afterAll(async () => {
    await stopTestApp();
  });

  const cabeceras = async () => (await http().get('/health')).headers;

  it('CRÍTICO: el navegador no adivina el tipo de contenido', async () => {
    // Sin esto, una respuesta que el navegador decida tratar como HTML puede ejecutar lo que
    // lleve dentro.
    expect((await cabeceras())['x-content-type-options']).toBe('nosniff');
  });

  it('CRÍTICO: la API no se puede meter en un marco', async () => {
    const headers = await cabeceras();

    expect(headers['x-frame-options']).toBe('DENY');
    // Y en la forma moderna, que es la que respetan los navegadores actuales.
    expect(headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
  });

  it('CRÍTICO: la política de contenido de una API es la más estricta posible', async () => {
    // Esto sirve JSON y algún PDF: no carga scripts, ni estilos, ni imágenes. `'none'` no es
    // una política ajustada con pinzas, es la descripción literal de lo que hace.
    expect((await cabeceras())['content-security-policy']).toContain(
      "default-src 'none'",
    );
  });

  it('la dirección de nuestras rutas no viaja a sitios de terceros', async () => {
    expect((await cabeceras())['referrer-policy']).toBe('no-referrer');
  });

  it('en producción se exige HTTPS', async () => {
    expect((await cabeceras())['strict-transport-security']).toContain(
      'max-age=',
    );
  });

  it('la interfaz, que vive en otro origen, sigue pudiendo leer las respuestas', async () => {
    // La política estricta de recursos entre orígenes está pensada para servidores que sirven
    // material incrustable. Aquí bloquearía el caso legítimo sin cerrar ninguno ilegítimo:
    // quién puede hablar con esta API lo decide la política de origen cruzado.
    expect((await cabeceras())['cross-origin-resource-policy']).toBe(
      'cross-origin',
    );
  });

  it('no se anuncia con qué está hecho', async () => {
    // `X-Powered-By: Express` le ahorra el primer paso a quien busca vulnerabilidades
    // conocidas de una versión concreta.
    expect((await cabeceras())['x-powered-by']).toBeUndefined();
  });
});

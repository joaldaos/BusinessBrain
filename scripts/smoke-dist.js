/**
 * Humo sobre `dist`, no sobre las fuentes.
 *
 * Los tests instancian conectores y servicios directamente, así que un proveedor que falte en
 * un módulo de NestJS pasa TODA la batería y revienta al arrancar. Ya ocurrió con
 * `WebPageConnector`. Esto arranca el grafo de inyección REAL desde el compilado —donde sí
 * existen los `design:paramtypes` que `tsx` no emite— y comprueba que Gmail está enchufado de
 * verdad: registro de conectores, rutas y puertos.
 */
const path = require('path');

// Relativo al propio script: una ruta absoluta funcionaría en una máquina y en ninguna otra,
// y este script existe precisamente para ejecutarse antes de desplegar.
const BACKEND = path.resolve(__dirname, '..', 'apps', 'backend');
const dist = (rel) => require(path.join(BACKEND, 'dist', 'src', rel));

async function main() {
  // Se resuelve desde el backend: en un monorepo las dependencias viven en la raíz.
  const { NestFactory } = require(
    require.resolve('@nestjs/core', { paths: [BACKEND] }),
  );
  const { AppModule } = dist('app.module');
  const {
    ConnectorRegistry,
  } = dist('knowledge-engine/infrastructure/connectors/connector-registry.service');
  const { GMAIL_PORT } = dist('integrations/domain/ports/gmail.port');
  const { GOOGLE_OAUTH_PORT } = dist('integrations/domain/ports/google-oauth.port');
  const {
    RestrictedPerimeterService,
  } = dist('knowledge-engine/application/restricted-perimeter.service');

  const app = await NestFactory.create(AppModule, { logger: false });

  // La MISMA función que `main.js`: cabeceras de seguridad, cookies, validación, filtro de
  // errores y política de origen cruzado. Sin esto, el humo probaría una aplicación desnuda
  // que no es la que se despliega — que es justo lo que este script existe para evitar.
  const { configureApp } = dist('bootstrap');
  configureApp(app, { isProduction: false, frontendUrl: 'http://localhost:5173' });

  await app.init();

  const fails = [];
  const check = (label, condition) => {
    if (!condition) fails.push(label);
    console.log(`${condition ? 'OK  ' : 'FALLA'} ${label}`);
  };

  // 1. El grafo entero se resuelve: es lo que ninguna prueba unitaria demuestra.
  const registry = app.get(ConnectorRegistry);
  check('el registro de conectores conoce gmail_v1', registry.keys().includes('gmail_v1'));
  check(
    'Gmail exige perímetro restringido',
    registry.get('gmail_v1').requiresRestrictedCollection === true,
  );
  check('Gmail va a BUSCAR su contenido (PULL)', registry.get('gmail_v1').acquisition === 'PULL');
  check(
    'los conectores anteriores siguen registrados',
    ['file_upload_v1', 'web_page_v1', 'google_drive_v1'].every((key) =>
      registry.keys().includes(key),
    ),
  );

  // 2. Los puertos nuevos están provistos.
  check('GMAIL_PORT resuelve a un adaptador', Boolean(app.get(GMAIL_PORT)));
  check('GOOGLE_OAUTH_PORT resuelve a un cliente', Boolean(app.get(GOOGLE_OAUTH_PORT)));
  check(
    'el perímetro restringido es inyectable',
    Boolean(app.get(RestrictedPerimeterService)),
  );

  // 2b. La ingesta puede hacer PREGUNTABLE lo que entra.
  //
  // El caso de uso existia y no lo llamaba nadie: el grafo resolvia igual y ningun documento
  // subido por una persona real era recuperable. Que sea inyectable no basta — se comprueba
  // que la tuberia de ingesta lo tiene entre sus dependencias.
  const {
    IngestFromSourceUseCase,
  } = dist('knowledge-engine/application/ingest-from-source.use-case');
  const { ChunkAndEmbedUseCase } = dist('knowledge-engine/application/chunk-and-embed.use-case');
  const ingest = app.get(IngestFromSourceUseCase);
  check('la ingesta resuelve', Boolean(ingest));
  check(
    'la ingesta puede vectorizar lo que entra',
    Object.values(ingest).some((dep) => dep instanceof ChunkAndEmbedUseCase),
  );

  // 2c. El registro de proveedores descifra: es el UNICO punto que lo hace.
  const {
    ProviderRegistry,
  } = dist('llm/application/provider-registry.service');
  const registro = app.get(ProviderRegistry);
  check(
    'el registro sabe resolver embeddings con su clave',
    typeof registro.resolveEmbeddingsForOrganization === 'function',
  );

  // 2d. PDF y Word se pueden leer DE VERDAD desde el compilado.
  //
  // Las librerias de extraccion se cargan al importar el modulo: si el bundle compilado no
  // pudiera resolverlas, la bateria pasaria igual y la primera subida de un cliente fallaria.
  const {
    normalizeContent,
  } = dist('knowledge-engine/application/normalize-content.use-case');
  const PDFDocument = require(require.resolve('pdfkit', { paths: [BACKEND] }));
  const pdfBytes = await new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40 });
    const trozos = [];
    doc.on('data', (c) => trozos.push(c));
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.text('Texto de comprobacion dentro de un PDF real');
    doc.end();
  });
  const normalizado = await normalizeContent(pdfBytes, 'application/pdf', 'humo.pdf');
  check(
    'un PDF real se convierte en texto desde el compilado',
    normalizado.text.includes('comprobacion'),
  );
  check(
    'y conserva la pagina para la cita',
    normalizado.text.includes('## Pagina 1') || normalizado.text.includes('Página 1'),
  );

  // 2e. El analisis puede PROPONER, y el modulo de recomendaciones NO puede ejecutar nada.
  const {
    TriggerAnalysisRunUseCase,
  } = dist('understanding-engine/application/trigger-analysis-run.use-case');
  const {
    ProposeFromInsightsUseCase,
  } = dist('understanding-engine/application/propose-from-insights.use-case');
  const analisis = app.get(TriggerAnalysisRunUseCase);
  check(
    'el analisis puede proponer recomendaciones',
    Object.values(analisis).some((dep) => dep instanceof ProposeFromInsightsUseCase),
  );

  const {
    RecommendationsService,
  } = dist('recommendations/application/recommendations.service');
  const recomendaciones = app.get(RecommendationsService);
  // Garantia ESTRUCTURAL: aceptar no ejecuta nada porque el modulo no tiene con que.
  check(
    'aceptar no tiene forma de ejecutar una accion externa',
    !Object.values(recomendaciones).some(
      (dep) => dep && typeof dep === 'object' && 'execute' in dep && 'registry' in dep,
    ),
  );

  // 3. Las rutas de Gmail responden de verdad.
  //
  // Se piden por HTTP contra el servidor arrancado, y no se inspecciona el router: lo que
  // importa es que la ruta EXISTA y esté guardada. Un 404 diría que no está registrada; un
  // 401 dice que está y que el guard la protege, que es exactamente lo que se quiere.
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();

  for (const [route, expected] of [
    ['/integrations/gmail/connect', 401],
    ['/integrations/cualquiera/labels', 401],
    // Preguntar: la superficie que el producto no tenia. Sin esta ruta viva, la pantalla
    // nueva no responderia a nada.
    ['/conversations', 401],
    // Configurar la IA: el primer paso de una empresa nueva. Sin esta ruta viva, una
    // instalacion nueva vuelve a nacer muerta.
    ['/ai-configuration', 401],
    ['/ai-configuration/providers', 401],
    // Formatos admitidos: la pantalla los pide aqui en vez de tener su propia lista, que fue
    // exactamente como el selector acabo ofreciendo PDF y Word cuando se rechazaban.
    ['/knowledge-sources/supported-formats', 401],
    // Recomendaciones: la superficie donde la empresa DECIDE.
    ['/recommendations', 401],
    // Privacidad: qué sale hacia la IA. Autenticada, pero no de organización.
    ['/privacy/notice', 401],
    // Cuánto se ha gastado hoy en IA. Sin esta ruta, el tope frena sin poder explicarse.
    ['/ai-configuration/usage', 401],
  ]) {
    const status = (await fetch(`${base}${route}`, { redirect: 'manual' })).status;
    check(`${route} responde ${expected} (existe y está protegida)`, status === expected);
  }

  // Recuperar la contraseña es PÚBLICO a la fuerza: quien no puede entrar no puede
  // autenticarse. Lo que se comprueba es que la ruta existe y no delata si el correo existe.
  const recuperacion = await fetch(`${base}/auth/password-reset/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nadie-con-esta-direccion@humo.local' }),
  });
  check(
    '/auth/password-reset/request acepta la petición (202) aunque el correo no exista',
    recuperacion.status === 202,
  );

  // Cabeceras de seguridad sobre el artefacto que se despliega, no sobre la app de pruebas.
  const salud = await fetch(`${base}/health`);
  check(
    'el navegador no adivina el tipo de contenido (nosniff)',
    salud.headers.get('x-content-type-options') === 'nosniff',
  );
  check(
    'la API no se puede meter en un marco',
    salud.headers.get('x-frame-options') === 'DENY',
  );
  check(
    'la política de contenido de la API es la más estricta',
    (salud.headers.get('content-security-policy') ?? '').includes(
      "default-src 'none'",
    ),
  );
  check(
    'no se anuncia con qué está hecho',
    salud.headers.get('x-powered-by') === null,
  );

  // El callback es público a la fuerza —Google redirige sin cabecera de sesión— y responde
  // con una redirección a la interfaz, nunca con un error que filtre el motivo.
  const callback = await fetch(
    `${base}/integrations/gmail/callback?error=access_denied`,
    { redirect: 'manual' },
  );
  check('el callback de Gmail redirige (302)', callback.status === 302);

  await app.close();

  console.log(fails.length === 0 ? '\nHUMO OK' : `\nHUMO FALLA: ${fails.join(', ')}`);
  // `process.exit` explícito: en Windows el cierre del pool de Prisma deja ruido de teardown
  // que no dice nada sobre estas comprobaciones.
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nHUMO FALLA AL ARRANCAR: ${error.message}`);
  process.exit(1);
});

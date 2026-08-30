import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import { makeDocx, makePdf } from '../../backend/test/documentos-reales';

/**
 * Los primeros minutos de una PYME, con un navegador de verdad.
 *
 * Recorrido: crear cuenta → **crear la empresa desde la interfaz** → colección → fuente →
 * subir un documento → preguntar → leer la respuesta CON SUS FUENTES.
 *
 * ## Qué detecta esto que no detectaba nada más
 *
 * Hasta ahora, quien se registraba llegaba a una pantalla que le decía que creara su
 * organización "desde la API": el producto era inalcanzable en el minuto uno y ninguna prueba lo
 * veía, porque todas las suites creaban la organización llamando a la API. Y el chat, que es lo
 * único que una PYME entiende en cinco segundos, no se llamaba desde ninguna pantalla.
 *
 * ## Cómo se sustituye el modelo
 *
 * Con un servidor local que responde como OpenAI, gracias a que las URLs del proveedor son
 * redirigibles fuera de producción (`externalEndpoint`). Es lo que permite comprobar el camino
 * COMPLETO —troceado, vectorización, recuperación, citas, pantalla— sin una clave real. Un doble
 * inyectado en el módulo sustituiría justo la parte que se quiere ver funcionando.
 *
 * Precondiciones del backend (puerto 3999): arrancado con `OPENAI_CHAT_URL` y
 * `OPENAI_EMBEDDINGS_URL` apuntando a este servidor, un `OPENAI_API_KEY` cualquiera —el
 * proveedor sigue exigiendo clave aunque el destino esté redirigido, y eso NO debe relajarse: es
 * la comprobación que evita salir a la red sin credencial— y un `LlmProfile` de plataforma por
 * defecto en la base de datos.
 */

const unique = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const EMAIL = `pyme-${unique}@test.local`;
const PASSWORD = 'Password123!';
const EMPRESA = `Panadería ${unique}`;
const COLECCION = 'Comercial';

/** Puerto FIJO: el backend se arranca antes y necesita conocer la dirección de antemano. */
const FAKE_OPENAI_PORT = Number(process.env.BB_FAKE_OPENAI_PORT ?? 4699);

const POLITICA =
  'La política de descuentos comerciales fija un máximo del quince por ciento para el canal ' +
  'mayorista. Cualquier descuento superior exige autorización expresa del responsable de área, ' +
  'registrada por escrito antes de trasladar la oferta al cliente.';

const ANEXO =
  'El anexo segundo recoge las condiciones de devolución acordadas con cada distribuidor, ' +
  'incluyendo los plazos máximos de aceptación y el procedimiento de reclamación.';

const TEXTO_WORD =
  'La propuesta comercial contempla un plazo de entrega de treinta días naturales desde la ' +
  'firma del contrato, con penalización por cada semana de retraso.';

/** Contrato completo, el que redactaría el modelo cuando sí tiene material. */
const PROPUESTA = JSON.stringify({
  title: 'Revisar la política de descuentos del canal mayorista',
  detected:
    'El documento que fija los descuentos ha perdido fiabilidad y conviene revisarlo.',
  justification:
    'Es la referencia que usa el equipo comercial para autorizar ofertas.',
  estimatedImpact: 'Evitar autorizaciones apoyadas en una versión desactualizada.',
  advantages: 'Devuelve fiabilidad a la referencia comercial y es reversible.',
  drawbacks: 'Exige dedicar tiempo del responsable de área a revisarlo.',
  affectedAreas: 'Área comercial y control de márgenes.',
  migrationPlan: 'Revisar el documento y volver a subirlo actualizado.',
});

const RESPUESTA =
  'El máximo autorizado es del quince por ciento en el canal mayorista [1].';

let openai: Server;

test.beforeAll(async () => {
  openai = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const json = (payload: unknown) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (req.url?.includes('/embeddings')) {
        const parsed = JSON.parse(body || '{}') as { input?: string[] };
        const inputs = parsed.input ?? [''];
        // La dimensión la fija el esquema (1536) y el caso de uso la comprueba: devolver otra
        // haría fallar la ingesta con un error explícito, que es lo correcto.
        json({
          data: inputs.map((text) => ({ embedding: vectorOf(text) })),
        });
        return;
      }

      // El chat pregunta por el contenido; el análisis pide después que se redacte la
      // propuesta. Se distinguen por lo que llega en el propio prompt, que es lo que hace que
      // el servidor sustituto no dependa del orden en que se llame.
      const pideUnaPropuesta = body.includes('migrationPlan');

      json({
        choices: [
          { message: { content: pideUnaPropuesta ? PROPUESTA : RESPUESTA } },
        ],
        usage: { total_tokens: 42 },
      });
    });
  });

  await new Promise<void>((resolve) =>
    openai.listen(FAKE_OPENAI_PORT, '127.0.0.1', resolve),
  );
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => openai.close(() => resolve()));
});

test('una PYME entra, conecta su conocimiento y obtiene una respuesta con fuentes', async ({
  page,
}) => {
  // ── 1. CREAR CUENTA desde la interfaz ─────────────────────────────────────
  await page.goto('/login');
  await page.getByRole('button', { name: /crear una/i }).click();
  await page.getByLabel('Nombre').fill('Dueña de la PYME');
  await page.getByLabel('Correo').fill(EMAIL);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  // ── 2. CREAR LA EMPRESA: el paso que antes remitía a la API ───────────────
  await expect(
    page.getByRole('heading', { name: /bienvenido a businessbrain/i }),
  ).toBeVisible();
  await page.getByLabel('Nombre de tu empresa').fill(EMPRESA);
  await page.getByRole('button', { name: /crear mi empresa/i }).click();

  // Y a partir de aquí sí hay producto: la navegación aparece con la empresa activa.
  await expect(
    page.getByRole('link', { name: 'Conocimiento', exact: true }),
  ).toBeVisible();

  // El panel dice qué falta, con el estado real de la cuenta. No se afirma QUÉ paso concreto
  // pide: si el despliegue trae una IA incluida, ese ya está hecho, y la prueba no debe
  // depender de con qué configuración se haya arrancado el servidor.
  await expect(page.getByText('Primeros pasos')).toBeVisible();
  await expect(
    page.getByRole('link', { name: /conecta una fuente/i }),
  ).toBeVisible();

  // ── 3. CONFIGURAR LA IA desde la interfaz ─────────────────────────────────
  //
  // Es el paso que antes solo se podía dar escribiendo en la base de datos. Sin él, lo que la
  // empresa suba no se puede preguntar.
  await page.getByRole('link', { name: 'Configuración', exact: true }).click();
  // El título de la tarjeta, no cualquier mención: el texto explicativo también la nombra.
  // `exact`: el producto tiene además "Tus datos y la inteligencia artificial", que explica
  // qué sale hacia el proveedor. Son dos tarjetas distintas y las dos deben estar — desde la
  // Fase 8, cada una en su sección: la clave es un ajuste, el aviso de privacidad es un
  // derecho, y apilarlos hacía que nadie leyera el segundo.
  await expect(
    page.getByRole('heading', { name: 'Inteligencia artificial', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Privacidad y datos', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: /tus datos y la inteligencia/i }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Inteligencia artificial', exact: true })
    .click();

  await page
    .getByLabel(/clave de openai/i)
    .fill('sk-la-clave-de-la-empresa-de-prueba');
  await page.getByRole('button', { name: /guardar y comprobar/i }).click();

  // Queda claro QUÉ configuración está usando: con clave propia, el consumo es de la empresa.
  await expect(page.getByText(/clave de tu empresa/i)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('lista', { exact: true })).toBeVisible();

  // ── 4. COLECCIÓN y FUENTE ─────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Conocimiento', exact: true }).click();
  await page.getByLabel('Nueva colección').fill(COLECCION);
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(
    page.locator('span').filter({ hasText: new RegExp(`^${COLECCION}$`) }),
  ).toBeVisible();

  await page.getByLabel('Nueva fuente').fill('Mis documentos');
  await page
    .getByLabel('Colección de destino')
    .selectOption({ label: COLECCION });
  await page.getByRole('button', { name: /crear fuente/i }).click();
  await expect(page.getByText('Mis documentos')).toBeVisible();

  // ── 5. SUBIR UN PDF Y UN WORD REALES ──────────────────────────────────────
  //
  // Son los documentos que sube una PYME. El selector los ofrecía y la ingesta los rechazaba:
  // aquí se comprueba con ficheros de verdad, generados en el propio test.
  const subirDocumento = async (file: {
    name: string;
    mimeType: string;
    buffer: Buffer;
  }) => {
    const respuesta = page.waitForResponse(
      (response) =>
        response.url().includes('/sync') &&
        response.request().method() === 'POST',
    );
    await page.locator('input[type="file"]').setInputFiles(file);
    expect((await respuesta).ok()).toBe(true);
  };

  await subirDocumento({
    name: 'politica-descuentos.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf([POLITICA, ANEXO]),
  });
  // La pantalla confirma el resultado de ESE documento, no solo que la petición fue bien.
  await expect(page.getByText(/indexado y listo para preguntar/i)).toBeVisible({
    timeout: 30_000,
  });

  await subirDocumento({
    name: 'propuesta.docx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: makeDocx([TEXTO_WORD]),
  });

  await page.reload();
  await expect(page.getByText('Documentos (2)')).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole('cell', { name: 'politica-descuentos.pdf' }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: 'propuesta.docx' })).toBeVisible();
  // Y NO se avisa de que falte indexar para búsqueda: si apareciera, el documento estaría
  // guardado pero no sería preguntable.
  await expect(page.getByText(/sin indexar para búsqueda/i)).toHaveCount(0);

  // ── 6. PREGUNTAR ──────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Preguntar', exact: true }).click();
  await expect(
    page.getByText(/pregunta con tus palabras/i),
  ).toBeVisible();

  await page.getByLabel('Tu pregunta').fill('¿Cuál es nuestro descuento máximo?');
  await page.getByRole('button', { name: 'Preguntar' }).click();

  // ── 7. LA RESPUESTA, CON SUS FUENTES ──────────────────────────────────────
  await expect(page.getByText(/quince por ciento/i)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('Fuentes')).toBeVisible();
  // `.first()`: un PDF de dos páginas rinde varias citas, y todas apuntan al mismo documento.
  await expect(
    page.getByText(/politica-descuentos\.pdf/i).first(),
  ).toBeVisible();
  // Y no se avisa de falta de fuentes: la respuesta se apoya en un documento real.
  await expect(page.getByText(/sin fuentes/i)).toHaveCount(0);

  // Queda escrito: se puede volver a leer.
  await page.reload();
  await expect(page.getByText(/quince por ciento/i)).toBeVisible({
    timeout: 30_000,
  });

  // ── 8. Y EL PANEL YA NO PIDE LO QUE ESTÁ HECHO ────────────────────────────
  await page.getByRole('link', { name: 'Panel', exact: true }).click();
  // El rótulo de la métrica, exacto: el panel también explica en una frase qué va a deducir
  // por su cuenta a partir de 'tus documentos'.
  await expect(page.getByText('Documentos', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /conecta una fuente/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: /hazle una pregunta/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: /configura la inteligencia artificial/i }),
  ).toHaveCount(0);

  // ── 9. ANALIZAR: BusinessBrain busca por su cuenta ────────────────────────
  //
  // Esta empresa exige fuentes muy fiables, así que lo recién ingerido queda por debajo del
  // listón y produce una señal determinista. Es un escenario real —una asesoría o una clínica
  // pondrían el listón así— y no depende de que el modelo razone.
  await page.getByRole('link', { name: 'Configuración', exact: true }).click();
  // La exigencia de fiabilidad es un parámetro de la EMPRESA: vive en su sección, no en la
  // primera pantalla de Configuración.
  await page.getByRole('button', { name: 'Empresa', exact: true }).click();
  await page.getByLabel(/exigencia de fiabilidad/i).fill('0.95');
  await page.getByRole('button', { name: /guardar exigencia/i }).click();
  await expect(page.getByText(/exigencia guardada/i)).toBeVisible();

  await page.getByRole('link', { name: 'Análisis', exact: true }).click();
  await page.getByRole('button', { name: /analizar ahora/i }).click();
  await expect(page.getByText(/conclusión\(es\) nueva\(s\)/i)).toBeVisible({
    timeout: 60_000,
  });

  // ── 10. LA RECOMENDACIÓN, como resultado del análisis ─────────────────────
  const enlacePropuestas = page.getByRole('link', {
    name: /recomendación\(es\) para revisar/i,
  });
  await expect(enlacePropuestas).toBeVisible({ timeout: 30_000 });
  await enlacePropuestas.click();

  const propuesta = page.getByRole('listitem').first();
  await expect(propuesta).toBeVisible();
  // Queda claro que la propone el sistema, no un compañero.
  await expect(
    propuesta.getByText(/propuesta por businessbrain/i),
  ).toBeVisible();
  // Con el contrato a la vista: qué se ha detectado y por dónde empezar.
  await expect(propuesta.getByText(/qué hemos detectado/i)).toBeVisible();
  await expect(propuesta.getByText(/por dónde empezar/i)).toBeVisible();
  // Y proponer no es hacer: la pantalla lo dice.
  await expect(page.getByText(/no ejecuta ninguna acción/i)).toBeVisible();

  // ── 11. VER LA EVIDENCIA: ¿por qué me propones esto? ──────────────────────
  await propuesta.getByRole('button', { name: /ver evidencia/i }).click();
  await expect(page.getByText(/por qué me propones esto/i)).toBeVisible();
  await expect(page.getByText(/sale de esta conclusión/i)).toBeVisible();

  // ── 12. DECIDIR, y que la decisión quede registrada ───────────────────────
  // Se espera la respuesta antes de abrir el historial: la lista se pide UNA vez al
  // desplegarla, así que pedirla antes de que la decisión esté guardada devolvería una lista
  // vacía que ya no se vuelve a consultar.
  const decision = page.waitForResponse(
    (response) =>
      response.url().includes('/accept') &&
      response.request().method() === 'POST',
  );
  await propuesta.getByRole('button', { name: 'Aceptar', exact: true }).click();
  expect((await decision).ok()).toBe(true);

  await page
    .getByRole('button', { name: /ver decisiones anteriores/i })
    .click();
  const decidida = page.getByRole('listitem').filter({ hasText: 'aceptada' });
  await expect(decidida).toBeVisible({ timeout: 30_000 });
  // Con quién decidió y cuándo: la decisión es de una persona, y queda dicho. Se busca dentro
  // de la fila, no en toda la página — el nombre también sale en la cabecera de sesión.
  await expect(decidida).toContainText('Dueña de la PYME');
});

/** Vector unitario de 1536 dimensiones derivado del texto. Determinista a propósito. */
function vectorOf(text: string): number[] {
  let seed = 0;
  for (const char of text) seed = (seed * 31 + char.charCodeAt(0)) % 2147483647;

  const values = Array.from({ length: 1536 }, () => {
    seed = (seed * 1103515245 + 12345) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  });
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0)) || 1;

  return values.map((value) => value / norm);
}

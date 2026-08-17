import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';

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

      json({
        choices: [{ message: { content: RESPUESTA } }],
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
    page.getByRole('combobox', { name: /organización activa/i }),
  ).toHaveValue(/.+/);

  // El panel dice qué falta, con el estado real de la cuenta.
  await expect(page.getByText('Primeros pasos')).toBeVisible();
  await expect(page.getByRole('link', { name: /conecta una fuente/i })).toBeVisible();

  // ── 3. COLECCIÓN y FUENTE ─────────────────────────────────────────────────
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

  // ── 4. SUBIR UN DOCUMENTO ─────────────────────────────────────────────────
  const subida = page.waitForResponse(
    (response) =>
      response.url().includes('/sync') && response.request().method() === 'POST',
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: 'politica-descuentos.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(POLITICA, 'utf8'),
  });
  expect((await subida).ok()).toBe(true);

  await page.reload();
  await expect(page.getByText('Documentos (1)')).toBeVisible({
    timeout: 30_000,
  });
  // Y NO se avisa de que falte indexar para búsqueda: si apareciera, el documento estaría
  // guardado pero no sería preguntable.
  await expect(page.getByText(/sin indexar para búsqueda/i)).toHaveCount(0);

  // ── 5. PREGUNTAR ──────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Preguntar', exact: true }).click();
  await expect(
    page.getByText(/pregunta con tus palabras/i),
  ).toBeVisible();

  await page.getByLabel('Tu pregunta').fill('¿Cuál es nuestro descuento máximo?');
  await page.getByRole('button', { name: 'Preguntar' }).click();

  // ── 6. LA RESPUESTA, CON SUS FUENTES ──────────────────────────────────────
  await expect(page.getByText(/quince por ciento/i)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('Fuentes')).toBeVisible();
  await expect(page.getByText(/politica-descuentos\.txt/i)).toBeVisible();
  // Y no se avisa de falta de fuentes: la respuesta se apoya en un documento real.
  await expect(page.getByText(/sin fuentes/i)).toHaveCount(0);

  // Queda escrito: se puede volver a leer.
  await page.reload();
  await expect(page.getByText(/quince por ciento/i)).toBeVisible({
    timeout: 30_000,
  });

  // ── 7. Y EL PANEL YA NO PIDE LO QUE ESTÁ HECHO ────────────────────────────
  await page.getByRole('link', { name: 'Panel', exact: true }).click();
  await expect(page.getByText('Documentos')).toBeVisible();
  await expect(
    page.getByRole('link', { name: /conecta una fuente/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: /hazle una pregunta/i }),
  ).toHaveCount(0);
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

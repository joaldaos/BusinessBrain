import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';

/**
 * Conectar Gmail con un navegador de verdad.
 *
 * No comprueba que los componentes rendericen: comprueba que **una persona puede conectar su
 * correo y verlo convertido en conocimiento**. Cada paso es un clic, y la vuelta del
 * consentimiento es una navegación real del navegador — que es justo el paso que ninguna prueba
 * HTTP puede demostrar: ahí la cookie del flujo se pone a mano, y en un navegador la adjunta (o
 * no) la política `SameSite`.
 *
 * Google está sustituido por un servidor local: las URLs de Google son redirigibles fuera de
 * producción (`GOOGLE_OAUTH_BASE_URL`, `GOOGLE_TOKEN_URL`, `GMAIL_API_URL`), igual que
 * `ALLOW_LOOPBACK_FETCH` permite leer una página servida en local. Sin eso, este recorrido
 * exigiría una cuenta real y no podría ejecutarse en CI.
 *
 * El backend debe arrancarse apuntando a este servidor. Ver `FAKE_GOOGLE_PORT`.
 */

const unique = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const EMAIL = `gmail-${unique}@test.local`;
const PASSWORD = 'Password123!';
const ORG = `Empresa Gmail ${unique}`;
const COLLECTION = 'Correo comercial';
const API = process.env.BB_API_URL ?? 'http://localhost:3999';

/**
 * Puerto FIJO, no efímero.
 *
 * El backend se arranca antes que este test y necesita conocer la dirección de antemano, así
 * que no puede ser un puerto al azar.
 */
const FAKE_GOOGLE_PORT = Number(process.env.BB_FAKE_GOOGLE_PORT ?? 4599);

const CUERPO =
  'La política de descuentos comerciales supera el margen objetivo de forma recurrente en el ' +
  'segmento mayorista. Conviene revisar los umbrales por segmento antes del cierre del ' +
  'trimestre y acordar con dirección un límite explícito por operación.';

/** Cuerpo del mensaje en base64url, como lo entrega Gmail. */
const base64url = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

const MENSAJE = {
  id: 'msg-e2e-1',
  threadId: 'hilo-e2e-1',
  labelIds: ['Label_ventas'],
  internalDate: String(Date.parse('2026-08-12T09:30:00.000Z')),
  payload: {
    headers: [
      { name: 'Subject', value: 'Descuentos del canal mayorista' },
      { name: 'From', value: '"Ana García" <ana.garcia@empresa.test>' },
      { name: 'Date', value: 'Wed, 12 Aug 2026 09:30:00 +0000' },
    ],
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'text/plain', body: { data: base64url(CUERPO) } },
      // Un adjunto: NO debe descargarse ni indexarse en esta V1.
      {
        mimeType: 'application/pdf',
        body: { attachmentId: 'adj-1', size: 12345 },
      },
    ],
  },
};

let google: Server;

/**
 * Google sustituido: consentimiento, canje de código y la API de Gmail.
 *
 * La pantalla de consentimiento se resuelve con una redirección inmediata de vuelta al
 * callback, que es exactamente lo que hace Google cuando la persona acepta. Lo que se está
 * verificando de este lado es la vuelta, no la pantalla.
 */
test.beforeAll(async () => {
  google = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${FAKE_GOOGLE_PORT}`);
    const json = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    // Consentimiento aceptado: vuelta al callback con el código.
    if (url.pathname === '/o/oauth2/v2/auth') {
      const back = new URL(url.searchParams.get('redirect_uri')!);
      back.searchParams.set('state', url.searchParams.get('state')!);
      back.searchParams.set('code', 'codigo-e2e');
      res.writeHead(302, { location: back.toString() });
      res.end();
      return;
    }

    if (url.pathname === '/token') {
      json({
        access_token: 'acceso-e2e',
        refresh_token: 'refresco-e2e',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
      });
      return;
    }

    if (url.pathname === '/revoke') {
      json({});
      return;
    }

    if (url.pathname.endsWith('/profile')) {
      json({ emailAddress: 'comercial@empresa.test', historyId: '4242' });
      return;
    }

    if (url.pathname.endsWith('/labels')) {
      json({
        labels: [
          { id: 'Label_ventas', name: 'Ventas' },
          { id: 'Label_direccion', name: 'Dirección' },
        ],
      });
      return;
    }

    if (url.pathname.endsWith(`/messages/${MENSAJE.id}`)) {
      json(MENSAJE);
      return;
    }

    if (url.pathname.endsWith('/messages')) {
      // Solo lo de la etiqueta pedida: el resto del buzón no sale de aquí.
      const label = url.searchParams.get('labelIds');
      json({
        messages: label === 'Label_ventas' ? [{ id: MENSAJE.id }] : [],
      });
      return;
    }

    if (url.pathname.endsWith('/history')) {
      // Marcador caducado: el sistema debe caer a lectura completa sin duplicar nada.
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 404 } }));
      return;
    }

    res.writeHead(404);
    res.end('{}');
  });

  await new Promise<void>((resolve) =>
    google.listen(FAKE_GOOGLE_PORT, '127.0.0.1', resolve),
  );
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => google.close(() => resolve()));
});

/**
 * Cuenta, organización y colección, por API.
 *
 * Se prepara fuera del navegador a propósito: la interfaz no tiene pantalla para crear una
 * organización, y encadenar dos inicios de sesión en la misma página invalidaría el token de
 * refresco del primero. Todo lo que se prueba después es la interfaz.
 */
test.beforeAll(async ({ request }) => {
  const registered = await request.post(`${API}/auth/register`, {
    data: { email: EMAIL, password: PASSWORD, name: 'Persona Gmail' },
  });
  expect(registered.ok(), await registered.text()).toBe(true);

  const login = await request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const { data } = (await login.json()) as { data: { accessToken: string } };

  const org = await request.post(`${API}/organizations`, {
    data: { name: ORG },
    headers: { Authorization: `Bearer ${data.accessToken}` },
  });
  expect(org.ok(), await org.text()).toBe(true);
});

test('una persona conecta Gmail y su correo se convierte en conocimiento', async ({
  page,
}) => {
  // ── 1. ENTRAR ───────────────────────────────────────────────────────────────
  await page.goto('/login');
  await page.getByLabel('Correo').fill(EMAIL);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(
    page.getByRole('combobox', { name: /organización activa/i }),
  ).toHaveValue(/.+/);

  // ── 2. COLECCIÓN de destino ─────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Conocimiento', exact: true }).click();
  await page.getByLabel('Nueva colección').fill(COLLECTION);
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(
    page.locator('span').filter({ hasText: new RegExp(`^${COLLECTION}$`) }),
  ).toBeVisible();

  // ── 3. CONECTAR GMAIL: consentimiento y vuelta, de verdad ───────────────────
  //
  // Aquí el navegador sale a otro sitio y vuelve. Es el paso que ninguna prueba HTTP demuestra:
  // si la cookie del flujo fuera `SameSite=Strict`, el navegador no la adjuntaría en la vuelta
  // y la conexión fallaría siempre.
  await page.getByRole('button', { name: /conectar gmail/i }).click();
  await page.waitForURL(/google=conectado/, { timeout: 30_000 });

  const gmailCard = page.locator('section', { hasText: 'Gmail' }).first();
  await expect(gmailCard.getByText('activa')).toBeVisible();
  // Dice QUÉ cuenta, no solo que hay una conectada.
  await expect(page.getByText('comercial@empresa.test')).toBeVisible();

  // ── 4. FUENTE: etiqueta como frontera + colección restringida ───────────────
  await page.getByLabel('Tipo de fuente').selectOption('GMAIL');
  await page.getByLabel('Nueva fuente').fill('Correo de ventas');
  await page.getByLabel('Etiqueta de Gmail').selectOption({ label: 'Ventas' });
  await page
    .getByLabel('Colección de destino')
    .selectOption({ label: COLLECTION });
  await page.getByRole('button', { name: /crear fuente/i }).click();
  // La fila de la fuente, no la opción del desplegable de más abajo.
  const fila = page.getByRole('listitem').filter({ hasText: 'Correo de ventas' });
  await expect(fila).toBeVisible();
  // Y dice QUÉ etiqueta está entrando: sin eso, dos fuentes de Gmail son indistinguibles.
  await expect(fila).toContainText('Ventas');

  // ── 5. SINCRONIZAR ──────────────────────────────────────────────────────────
  const primera = page.waitForResponse(
    (r) => r.url().includes('/sync') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sincronizar', exact: true }).click();
  expect((await primera).ok()).toBe(true);

  await page.reload();
  await expect(page.getByText('Documentos (1)')).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole('cell', { name: /Descuentos del canal mayorista/i }),
  ).toBeVisible();

  // ── 6. LO QUE NO DEBE APARECER ──────────────────────────────────────────────
  const visible = await page.locator('main').innerText();
  // La dirección del REMITENTE no es conocimiento recuperable; su nombre sí.
  expect(visible).not.toContain('ana.garcia@empresa.test');
  expect(visible).toContain('Ana García');
  // Y ningún token de Google llega a la página, por ninguna vía.
  const almacenamiento = await page.evaluate(() => ({
    local: JSON.stringify(localStorage),
    cookies: document.cookie,
  }));
  expect(almacenamiento.local).not.toContain('acceso-e2e');
  expect(almacenamiento.local).not.toContain('refresco-e2e');
  expect(almacenamiento.cookies).not.toContain('refresco-e2e');

  // ── 7. SEGUNDA SINCRONIZACIÓN: no duplica ───────────────────────────────────
  const segunda = page.waitForResponse(
    (r) => r.url().includes('/sync') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sincronizar', exact: true }).click();
  expect((await segunda).ok()).toBe(true);

  await page.reload();
  // Sigue habiendo UN documento, y eso pese a que el marcador caducó y se releyó la etiqueta
  // entera: la deduplicación reconoció el mismo contenido.
  await expect(page.getByText('Documentos (1)')).toBeVisible();

  // ── 8. DESCONECTAR detiene la sincronización ────────────────────────────────
  //
  // Se ESPERA la respuesta antes de recargar. Recargar justo después de pulsar es una carrera:
  // el clic dispara la petición y la recarga puede llegar antes de que el servidor la haya
  // procesado, con lo que la página vuelve a pintar la conexión todavía activa. Era la causa
  // de que esta suite fallara una de cada tres ejecuciones.
  const desconexion = page.waitForResponse(
    (response) =>
      response.url().includes('/integrations/') &&
      response.request().method() === 'DELETE',
  );
  await page.getByRole('button', { name: /desconectar/i }).last().click();
  expect((await desconexion).ok()).toBe(true);

  await page.reload();

  // Se dice que se revocó —si no, nadie entendería por qué dejó de entrar correo— y a la vez
  // se puede VOLVER A CONECTAR. Desconectar no borra la conexión, así que durante un tiempo la
  // pantalla mostró "revocada" con un botón de desconectar y ninguna forma de reconectar: una
  // empresa que se desconectaba se quedaba sin Gmail para siempre.
  await expect(page.getByText('revocada')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /conectar gmail/i }),
  ).toBeVisible();

  // El conocimiento ya ingerido SOBREVIVE: lo que se detiene es traer más.
  await expect(page.getByText('Documentos (1)')).toBeVisible();
});

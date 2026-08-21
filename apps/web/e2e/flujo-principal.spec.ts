import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';

/**
 * El recorrido completo, con un navegador de verdad.
 *
 * No comprueba que los componentes rendericen: comprueba que **una persona puede usar
 * BusinessBrain**. Cada paso es un clic o una escritura, contra el backend real.
 *
 * Recorrido: registro → organización → colección → fuente web con una URL → leer la página →
 * el documento aparece en Conocimiento → objetivo → análisis → conclusión visible → curación
 * → historia → informe → PDF descargado → segunda lectura que NO duplica.
 */

const unique = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const EMAIL = `e2e-${unique}@test.local`;
const PASSWORD = 'Password123!';
const ORG = `Empresa E2E ${unique}`;
const COLLECTION = 'Ventas';
/** El backend real. El proxy de Vite lo expone en `/api`, pero desde Node se llama directo. */
const API = process.env.BB_API_URL ?? 'http://localhost:3999';

/**
 * Página que el conector irá a leer.
 *
 * Se sirve desde el propio test para no depender de internet — un E2E que falla porque un
 * sitio externo está caído no informa de nada sobre nuestro código.
 */
const PAGE_HTML = `<!doctype html>
<html><head><title>Política de descuentos comerciales</title></head>
<body>
  <nav>Inicio · Contacto</nav>
  <h1>Política de descuentos comerciales</h1>
  <p>Los descuentos aplicados por el equipo comercial superan de forma recurrente el margen
  objetivo declarado por la compañía para el ejercicio en curso. La dirección revisa cada
  trimestre los umbrales aplicables por segmento de cliente, atendiendo al volumen contratado
  y a la antigüedad de la relación comercial mantenida hasta la fecha.</p>
  <p>Cualquier descuento superior al quince por ciento exige autorización expresa del
  responsable de área, registrada por escrito antes de trasladar la oferta al cliente.</p>
  <script>console.log('esto no es contenido');</script>
</body></html>`;

let pageServer: Server;
let pageUrl = '';

test.beforeAll(async () => {
  pageServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE_HTML);
  });
  // En 127.0.0.1: el guard anti-SSRF lo rechazaría en producción, y es lo correcto. Aquí el
  // backend de desarrollo permite el bucle local mediante ALLOW_LOOPBACK_FETCH.
  await new Promise<void>((resolve) =>
    pageServer.listen(0, '127.0.0.1', resolve),
  );
  pageUrl = `http://127.0.0.1:${(pageServer.address() as AddressInfo).port}/politica`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => pageServer.close(() => resolve()));
});

/**
 * Prepara la cuenta y su organización por API.
 *
 * Se hace desde fuera del navegador a propósito: la UI todavía no tiene pantalla para crear
 * una organización, y encadenar dos inicios de sesión dentro de la misma página invalidaría
 * el token de refresco del primero. Después de esto, TODO lo que se prueba es la interfaz.
 */
test.beforeAll(async ({ request }) => {
  const registered = await request.post(`${API}/auth/register`, {
    data: { email: EMAIL, password: PASSWORD, name: 'Persona E2E' },
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
  const created = (await org.json()) as { data: { id: string } };

  // Esta empresa exige fuentes muy fiables: por debajo de 0,7 el conocimiento deja de
  // considerarse recuperable y el motor lo señala. Es un escenario real —una asesoría o una
  // clínica pondrían el listón así— y es lo que hace que haya ALGO que comprender sobre una
  // página recién leída, en vez de tener que falsear datos en la base.
  const settings = await request.patch(`${API}/organizations/${created.data.id}`, {
    data: {
      settings: { knowledgeEngine: { confidence: { minimumFloor: 0.7 } } },
    },
    headers: { Authorization: `Bearer ${data.accessToken}` },
  });
  expect(settings.ok(), await settings.text()).toBe(true);
});

test('una persona recorre BusinessBrain de principio a fin', async ({ page }) => {
  // ── 1. ENTRAR ─────────────────────────────────────────────────────────────
  await page.goto('/login');
  await page.getByLabel('Correo').fill(EMAIL);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(
    page.getByRole('combobox', { name: /organización activa/i }),
  ).toHaveValue(/.+/);

  // ── 2. CONOCIMIENTO: colección ────────────────────────────────────────────
  await page.getByRole('link', { name: 'Conocimiento', exact: true }).click();
  await page.getByLabel('Nueva colección').fill(COLLECTION);
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  // El badge de la lista, no la opción del desplegable de más abajo.
  await expect(
    page.locator('span').filter({ hasText: new RegExp(`^${COLLECTION}$`) }),
  ).toBeVisible();

  // ── 3. FUENTE WEB con una URL ─────────────────────────────────────────────
  await page.getByLabel('Tipo de fuente').selectOption('WEBSITE');
  await page.getByLabel('Nueva fuente').fill('Política de descuentos');
  await page.getByLabel('Dirección web').fill(pageUrl);
  await page.getByLabel('Colección de destino').selectOption({ label: COLLECTION });
  await page.getByRole('button', { name: /crear fuente/i }).click();
  await expect(page.getByText('Política de descuentos')).toBeVisible();

  // ── 4. LEER LA PÁGINA: el contenido entra en BusinessBrain ────────────────
  const primeraLectura = page.waitForResponse(
    (r) => r.url().includes('/sync') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /leer la página/i }).click();
  expect((await primeraLectura).ok()).toBe(true);

  await page.reload();
  await expect(
    page.getByRole('cell', { name: /Política de descuentos comerciales/i }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Documentos (1)')).toBeVisible();

  // ── 5. SEGUNDA LECTURA: no duplica ────────────────────────────────────────
  const segundaLectura = page.waitForResponse(
    (r) => r.url().includes('/sync') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /leer la página/i }).click();
  expect((await segundaLectura).ok()).toBe(true);

  await page.reload();
  // Sigue habiendo UN documento: la deduplicación reconoció el mismo contenido.
  await expect(page.getByText('Documentos (1)')).toBeVisible();

  // ── 6. OBJETIVO ───────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Objetivos', exact: true }).click();
  await page.getByLabel('Objetivo').fill('El margen comercial no debe bajar del 30 %.');
  await page.getByRole('button', { name: 'Declarar' }).click();
  await expect(page.getByText('confirmado')).toBeVisible();

  // ── 7. ANÁLISIS ───────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Análisis', exact: true }).click();
  await page.getByRole('button', { name: /analizar ahora/i }).click();
  await expect(page.getByText(/conclusión\(es\) nueva\(s\)/i)).toBeVisible({
    timeout: 60_000,
  });

  // ── 8. COMPRENSIÓN visible ────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Comprensión', exact: true }).click();
  const conclusion = page.locator('main li a').first();
  await expect(conclusion).toBeVisible({ timeout: 30_000 });
  await conclusion.click();

  // ── 9. CURACIÓN ───────────────────────────────────────────────────────────
  await expect(page.getByText('Tu decisión')).toBeVisible();
  await page.getByLabel('Comentario (opcional)').fill('Correcto, hay que revisarlo.');
  await page.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByText('Decisión registrada.')).toBeVisible();

  // ── 10. HISTORIA de la creencia ───────────────────────────────────────────
  await expect(page.getByText(/cómo ha cambiado esta creencia/i)).toBeVisible();
  await expect(page.getByText(/versión actual/i)).toBeVisible();

  // ── 11. INFORME ───────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Informes', exact: true }).click();
  await page.getByLabel('Nombre del informe').fill('Resumen semanal');
  await page.getByRole('button', { name: /crear informe/i }).click();
  await expect(page.getByText('Informes (1)')).toBeVisible();

  // ── 12. PDF descargado de verdad ──────────────────────────────────────────
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: /descargar pdf/i }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);

  // ── 13. LA SESIÓN NO ES LEGIBLE POR NINGÚN SCRIPT ─────────────────────────
  const almacenamiento = await page.evaluate(() => ({
    local: JSON.stringify(localStorage),
    // `document.cookie` no ve las cookies `HttpOnly`: es exactamente lo que hace un XSS.
    cookiesVisibles: document.cookie,
  }));

  expect(almacenamiento.local).not.toContain('refresh');
  expect(almacenamiento.cookiesVisibles).not.toContain('bb_refresh');
  // El testigo CSRF sí es visible, y debe serlo: es la mitad del doble envío.
  expect(almacenamiento.cookiesVisibles).toContain('bb_csrf');

  // La sesión sobrevive a una recarga completa aunque el token de acceso viva en memoria:
  // el navegador conserva la cookie y la renueva sola.
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: /organización activa/i }),
  ).toHaveValue(/.+/);

  // ── 14. AUTOMATIZACIÓN que lo encadena todo sin nadie delante ─────────────
  await page.getByRole('link', { name: 'Automatizaciones', exact: true }).click();
  await page.getByLabel('Nombre').fill('Barrido semanal');
  await page
    .getByLabel('Fuente a sincronizar')
    .selectOption({ label: 'Política de descuentos' });
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.getByText('Barrido semanal')).toBeVisible();
  await expect(
    page.getByText(/SYNC_KNOWLEDGE_SOURCE.*RUN_ANALYSIS/),
  ).toBeVisible();

  // Y se ejecuta: conocimiento, comprensión e informe, sin intervención.
  await page.getByRole('button', { name: /ejecutar ahora/i }).click();
  await page.getByRole('button', { name: 'Ejecuciones' }).click();
  // En castellano: la pantalla ya no pinta la constante interna del backend.
  await expect(page.getByText('correcto').first()).toBeVisible({
    timeout: 60_000,
  });

  // ── 15. CERRAR SESIÓN la revoca de verdad ─────────────────────────────────
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();

  // Y una recarga NO la recupera: el servidor revocó el token y borró la cookie.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
});

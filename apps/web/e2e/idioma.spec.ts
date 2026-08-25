import { expect, test } from '@playwright/test';

/**
 * El idioma de la interfaz, con un navegador de verdad.
 *
 * ## Qué detecta esto que no detecta ninguna otra prueba
 *
 * Que el idioma llega a TODAS las pantallas y sobrevive a una recarga. Un catálogo perfecto y
 * un proveedor bien escrito no sirven de nada si una pantalla se quedó sin conectar o si la
 * preferencia no se guardó: el cliente lo descubriría al volver al día siguiente y encontrarlo
 * otra vez en castellano.
 *
 * Y comprueba lo único que no se puede comprobar leyendo el catálogo: que en la pantalla real
 * no aparece vocabulario interno. Las constantes del backend —`INDEXED`, `OWNER`, `ANOMALY`—
 * llegan por la API, así que una pantalla que las pinte sin traducir pasa cualquier prueba de
 * catálogo y falla delante de un cliente.
 */

const unique = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Constantes que NUNCA pueden verse. Es el vocabulario de un modelo de datos. */
const VOCABULARIO_INTERNO =
  /\b(INDEXED|PROCESSING|SUPERSEDED|ANOMALY|PATTERN|OPPORTUNITY|OWNER|ADMIN|MEMBER|VIEWER|CANDIDATE|DISMISSED|FRESH|STALE|UNRESOLVABLE|RUN_ANALYSIS|SYNC_KNOWLEDGE_SOURCE|GENERATE_REPORT)\b/;

async function crearCuentaYEmpresa(page: import('@playwright/test').Page) {
  const email = `idioma-${unique()}@test.local`;

  await page.goto('/login');
  await page.getByRole('button', { name: /crear una/i }).click();
  await page.getByLabel('Nombre').fill('Dueña bilingüe');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill('Password123!');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await page.getByLabel('Nombre de tu empresa').fill(`Bilingüe ${unique()}`);
  await page.getByRole('button', { name: /crear mi empresa/i }).click();
  await expect(
    page.getByRole('combobox', { name: /organización activa/i }),
  ).toHaveValue(/.+/);
}

test('una PYME cambia el idioma, y se le queda', async ({ page }) => {
  await crearCuentaYEmpresa(page);

  // ── LA NAVEGACIÓN ESTÁ EN CASTELLANO ──────────────────────────────────────
  await expect(page.getByRole('link', { name: 'Conocimiento' })).toBeVisible();

  // ── CAMBIAR A INGLÉS DESDE CONFIGURACIÓN ──────────────────────────────────
  await page.getByRole('link', { name: 'Configuración' }).click();

  const guardado = page.waitForResponse(
    (response) =>
      response.url().includes('/auth/me/language') && response.ok(),
  );
  await page
    .getByRole('combobox', { name: /idioma|language/i })
    .selectOption('en');
  await guardado;

  // Toda la navegación cambia, no solo la pantalla en la que estaba.
  await expect(page.getByRole('link', { name: 'Knowledge' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Recommendations' })).toBeVisible();

  // ── SOBREVIVE A UNA RECARGA ───────────────────────────────────────────────
  //
  // Es lo que separa "cambia el idioma" de "guarda la preferencia": sin esto, el cliente lo
  // encontraría otra vez en castellano al volver al día siguiente.
  await page.reload();
  await expect(page.getByRole('link', { name: 'Knowledge' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Conocimiento' })).toBeHidden();

  // Y el documento declara su idioma, que es lo que usan los lectores de pantalla.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  // ── LAS PANTALLAS DE VERDAD, EN INGLÉS Y SIN JERGA ────────────────────────
  for (const [enlace, señal] of [
    ['Knowledge', /Collections/i],
    ['Ask', /Ask your company/i],
    ['Understanding', /Conclusions/i],
    ['Recommendations', /Waiting for your decision/i],
    ['Reports', /Reports/i],
  ] as const) {
    await page.getByRole('link', { name: enlace, exact: true }).click();
    await expect(page.getByText(señal).first()).toBeVisible();

    // CRÍTICO: ninguna pantalla enseña constantes del backend.
    const texto = (await page.locator('main').innerText()) ?? '';
    expect(
      VOCABULARIO_INTERNO.test(texto),
      `vocabulario interno visible en ${enlace}: ${texto.slice(0, 300)}`,
    ).toBe(false);
  }

  // ── Y SE PUEDE VOLVER ─────────────────────────────────────────────────────
  //
  // Los idiomas se ofrecen en su propia lengua justamente para esto: quien se lo cambió por
  // error tiene que reconocer el suyo.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page
    .getByRole('combobox', { name: /language/i })
    .selectOption('es');
  await expect(page.getByRole('link', { name: 'Conocimiento' })).toBeVisible();
});

test.describe('un navegador en inglés', () => {
  test.use({ locale: 'en-GB' });

  test('recibe la pantalla de entrada en inglés sin tener cuenta', async ({
    page,
  }) => {
    // Quien entra por primera vez desde un navegador en inglés no debería tener que buscar un
    // selector para poder leer la pantalla de registro.
    await page.goto('/login');

    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: /forgotten your password/i }),
    ).toBeVisible();
  });

  test('y también la de recuperar la contraseña', async ({ page }) => {
    await page.goto('/recuperar');

    await expect(page.getByRole('button', { name: /send me the link/i })).toBeVisible();
  });
});

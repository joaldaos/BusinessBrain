import { expect, test, type Page } from '@playwright/test';
import { correosPara, limpiarBuzon } from './buzon';

/**
 * Una PYME que ha olvidado su contraseña vuelve a entrar sola, con un navegador de verdad.
 *
 * Recorrido: crear cuenta → volver otro día sin sesión → pedir el enlace → abrir el correo →
 * contraseña nueva → entrar.
 *
 * ## Qué detecta esto que no detecta la prueba HTTP
 *
 * Que el camino EXISTE en la interfaz. La prueba HTTP demuestra que las rutas funcionan; solo
 * esta demuestra que hay un enlace visible en la pantalla de entrada, que el correo lleva una
 * URL que el navegador sabe abrir, y que esa URL cae en una pantalla que acepta la contraseña
 * nueva. Un backend perfecto al que no se llega desde ninguna pantalla no rescata a nadie —
 * exactamente lo que le pasaba a este producto antes de esta fase.
 *
 * El correo se lee del buzón en fichero que escribe el backend. El testigo no aparece en
 * ninguna respuesta HTTP, ni siquiera en pruebas.
 */

const unique = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

test.beforeAll(async () => {
  await limpiarBuzon();
});

/** Crea una cuenta desde la interfaz y deja el navegador SIN sesión, como quien vuelve otro día. */
async function cuentaOlvidada(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: /crear una/i }).click();
  await page.getByLabel('Nombre').fill('Dueña olvidadiza');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(
    page.getByRole('heading', { name: /bienvenido a businessbrain/i }),
  ).toBeVisible();

  // Se olvida la contraseña días después, con la sesión ya caducada. Vaciar las cookies es
  // exactamente eso: el navegador ya no sabe quién es.
  await page.context().clearCookies();
}

/** El enlace del último correo de recuperación mandado a esa dirección. */
async function enlaceDeRecuperacion(email: string): Promise<string> {
  const correos = await correosPara(email);
  const ultimo = correos.at(-1);
  expect(ultimo, 'no llegó ningún correo de recuperación').toBeTruthy();

  const encontrado = /(http:\/\/\S*\/restablecer\?token=[a-f0-9]+)/.exec(
    ultimo!.body,
  );
  expect(encontrado, 'el correo no traía enlace').toBeTruthy();
  return encontrado![1];
}

async function pedirElEnlace(page: Page, email: string) {
  await page.getByLabel('Correo').fill(email);
  const peticion = page.waitForResponse(
    (response) =>
      response.url().includes('/auth/password-reset/request') &&
      response.status() === 202,
  );
  await page.getByRole('button', { name: /enviarme el enlace/i }).click();
  const respuesta = await peticion;

  await expect(page.getByText(/mira tu correo/i)).toBeVisible();
  return respuesta;
}

test('una PYME que ha olvidado su contraseña vuelve a entrar sin que nadie toque la base de datos', async ({
  page,
}) => {
  const email = `olvidadiza-${unique()}@test.local`;
  const passwordNueva = 'PasswordNueva456!';

  await cuentaOlvidada(page, email, 'Password123!');

  // ── EL ENLACE TIENE QUE ESTAR DONDE SE BUSCA ──────────────────────────────
  //
  // En la pantalla de entrada. Si solo existiera la ruta, no rescataría a nadie.
  await page.goto('/login');
  const olvidada = page.getByRole('link', {
    name: /has olvidado tu contrase/i,
  });
  await expect(olvidada).toBeVisible();
  await olvidada.click();

  // ── PEDIRLO ───────────────────────────────────────────────────────────────
  const respuesta = await pedirElEnlace(page, email);

  // CRÍTICO: el testigo no viaja en la respuesta. Si volviera aquí, cualquiera podría pedir la
  // recuperación de otra persona y leer el enlace.
  expect(await respuesta.text()).not.toMatch(/token/i);

  // ── ABRIR EL CORREO Y ELEGIR CONTRASEÑA ───────────────────────────────────
  await page.goto(await enlaceDeRecuperacion(email));
  await page.getByLabel('Contraseña').fill(passwordNueva);
  await page.getByLabel('Repítela').fill(passwordNueva);
  await page.getByRole('button', { name: /guardar y entrar/i }).click();

  await expect(page.getByText(/ya tienes contraseña nueva/i)).toBeVisible();

  // ── ENTRAR CON LA NUEVA ───────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Entrar' }).click();
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(passwordNueva);
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Está dentro: la empresa se crea después, así que la pantalla que toca es la de bienvenida.
  await expect(
    page.getByRole('heading', { name: /bienvenido a businessbrain/i }),
  ).toBeVisible();
});

test('el enlace no sirve dos veces', async ({ page }) => {
  const email = `dos-veces-${unique()}@test.local`;
  await cuentaOlvidada(page, email, 'Password123!');

  await page.goto('/recuperar');
  await pedirElEnlace(page, email);
  const enlace = await enlaceDeRecuperacion(email);

  await page.goto(enlace);
  await page.getByLabel('Contraseña').fill('OtraMas789!');
  await page.getByLabel('Repítela').fill('OtraMas789!');
  await page.getByRole('button', { name: /guardar y entrar/i }).click();
  await expect(page.getByText(/ya tienes contraseña nueva/i)).toBeVisible();

  // Segundo uso del MISMO enlace: se rechaza, y con un mensaje que se entiende.
  await page.goto(enlace);
  await page.getByLabel('Contraseña').fill('YOtraMas000!');
  await page.getByLabel('Repítela').fill('YOtraMas000!');
  await page.getByRole('button', { name: /guardar y entrar/i }).click();

  await expect(page.getByText(/este enlace ya no sirve/i)).toBeVisible();
  await expect(page.getByText(/ya tienes contraseña nueva/i)).toBeHidden();
});

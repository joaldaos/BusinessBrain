import { expect, test, type Page } from '@playwright/test';
import {
  abrirBuzonDePruebas,
  type BuzonDePruebas,
} from '../../backend/test/buzon-smtp';

/**
 * Una PYME que ha olvidado su contraseña vuelve a entrar sola, con un navegador de verdad y
 * un correo de verdad.
 *
 * Recorrido: crear cuenta → volver otro día sin sesión → pedir el enlace → **el correo sale
 * por SMTP a un buzón real** → abrirlo → contraseña nueva → entrar.
 *
 * ## Qué detecta esto que no detecta la prueba HTTP
 *
 * Que el camino EXISTE de punta a punta. La prueba HTTP demuestra que las rutas funcionan;
 * solo esta demuestra que hay un enlace visible en la pantalla de entrada, que el correo SALE,
 * que el enlace sobrevive a la codificación del cuerpo, que el navegador sabe abrirlo y que
 * esa URL cae en una pantalla que acepta la contraseña nueva.
 *
 * ## El buzón es un servidor SMTP local, no una cuenta de nadie
 *
 * El backend arranca apuntando aquí (`SMTP_URL` en la configuración de Playwright) y usa el
 * MISMO adaptador que se despliega. Una prueba que dependiera del buzón personal de alguien
 * dejaría de pasar el día que esa persona cambia la contraseña, y no se podría ejecutar en
 * otra máquina.
 *
 * El testigo no aparece en ninguna respuesta HTTP, ni siquiera en pruebas: llega por correo,
 * como al cliente.
 */

const PUERTO_SMTP = 2527;
let buzon: BuzonDePruebas;

const unique = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

test.beforeAll(async () => {
  buzon = await abrirBuzonDePruebas(PUERTO_SMTP);
});

test.afterAll(async () => {
  await buzon.cerrar();
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

/** El enlace del último correo recibido en esa dirección. */
function enlaceDeRecuperacion(email: string): string {
  const correos = buzon.recibidos.filter((correo) => correo.to.includes(email));
  const ultimo = correos.at(-1);
  expect(ultimo, 'no llegó ningún correo de recuperación').toBeTruthy();

  const encontrado = /(http:\/\/\S*\/restablecer\?token=[a-f0-9]+)/.exec(
    ultimo!.body,
  );
  expect(encontrado, 'el correo no traía enlace').toBeTruthy();
  return encontrado![1];
}

/**
 * Pide el enlace y espera a que el correo haya SALIDO.
 *
 * La respuesta HTTP llega antes de que el mensaje termine de entregarse por SMTP, así que
 * mirar el buzón justo después encontraría a veces cero correos. Es la clase de carrera que
 * produce una suite intermitente, y una suite intermitente acaba ignorándose.
 */
async function pedirElEnlace(page: Page, email: string) {
  const antes = buzon.recibidos.length;

  await page.getByLabel('Correo').fill(email);
  const peticion = page.waitForResponse(
    (response) =>
      response.url().includes('/auth/password-reset/request') &&
      response.status() === 202,
  );
  await page.getByRole('button', { name: /enviarme el enlace/i }).click();
  const respuesta = await peticion;

  await expect(page.getByText(/mira tu correo/i)).toBeVisible();
  await expect
    .poll(() => buzon.recibidos.length, {
      message: 'el correo no llegó al buzón',
    })
    .toBeGreaterThan(antes);

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

  // ── EL CORREO SALIÓ DE VERDAD ─────────────────────────────────────────────
  const correo = buzon.recibidos.at(-1)!;
  expect(correo.to).toContain(email);
  expect(correo.from).toBe('no-reply@businessbrain.test');
  expect(correo.subject).toBe('Recupera tu acceso a BusinessBrain');
  // Y la credencial del buzón no viaja dentro del mensaje.
  expect(correo.raw).not.toContain('clave-del-buzon-de-pruebas');

  // ── ABRIR EL CORREO Y ELEGIR CONTRASEÑA ───────────────────────────────────
  await page.goto(enlaceDeRecuperacion(email));
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

  // ── Y LA VIEJA YA NO VALE ─────────────────────────────────────────────────
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill('Password123!');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(
    page.getByRole('heading', { name: /bienvenido a businessbrain/i }),
  ).toBeHidden();
});

test('el enlace no sirve dos veces', async ({ page }) => {
  const email = `dos-veces-${unique()}@test.local`;
  await cuentaOlvidada(page, email, 'Password123!');

  await page.goto('/recuperar');
  await pedirElEnlace(page, email);
  const enlace = enlaceDeRecuperacion(email);

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

test('a un correo que no existe no se le manda nada, y no se nota la diferencia', async ({
  page,
}) => {
  // Es la garantía contra el rastreo de clientes: la pantalla responde igual exista la cuenta
  // o no. Con un buzón real se puede comprobar de verdad que además NO sale ningún correo.
  const antes = buzon.recibidos.length;

  await page.goto('/recuperar');
  await page.getByLabel('Correo').fill(`no-existe-${unique()}@test.local`);
  await page.getByRole('button', { name: /enviarme el enlace/i }).click();

  await expect(page.getByText(/mira tu correo/i)).toBeVisible();
  expect(buzon.recibidos.length).toBe(antes);
});

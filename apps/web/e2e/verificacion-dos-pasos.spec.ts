import { expect, test, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';

/**
 * Activar la verificación en dos pasos y volver a entrar, en un navegador de verdad.
 *
 * ## Qué demuestra esto que no demuestra la prueba HTTP
 *
 * Que el camino EXISTE para una persona. Las rutas pueden ser perfectas y la pantalla no tener
 * botón, o tenerlo detrás de un desplegable que nadie encuentra, o enseñar los códigos de
 * repuesto en un sitio del que desaparecen antes de que dé tiempo a copiarlos. Nada de eso se
 * ve desde `supertest`.
 *
 * También comprueba lo que se pidió explícitamente: que en pantalla no aparece vocabulario
 * interno. Ni "TOTP", ni "secret", ni "MFA_ENABLED".
 *
 * ## El código se calcula aquí con el mismo algoritmo que la aplicación del móvil
 *
 * Se lee la clave que la propia pantalla muestra para escribir a mano y se genera el código con
 * TOTP estándar. Es exactamente lo que hace Google Authenticator: si el QR y la clave no
 * correspondieran al secreto guardado, este código no serviría y la prueba fallaría.
 */

const unique = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** TOTP (RFC 6238), lo mismo que hace la aplicación del móvil con la clave escaneada. */
function totp(secretBase32: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secretBase32.toUpperCase().replace(/[\s=]/g, '');

  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const character of clean) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  const counter = Math.floor(Date.now() / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', Buffer.from(bytes))
    .update(message)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
}

async function crearCuentaYEmpresa(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: /crear una/i }).click();
  await page.getByLabel('Nombre').fill('Dueña precavida');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(
    page.getByRole('heading', { name: /bienvenido a businessbrain/i }),
  ).toBeVisible();

  await page.getByLabel(/nombre de tu empresa/i).fill(`Ferretería ${unique()}`);
  await page.getByRole('button', { name: /crear/i }).click();
  await expect(page.getByRole('link', { name: /configuración/i })).toBeVisible();
}

test('una PYME activa la verificación en dos pasos y vuelve a entrar con el código', async ({
  page,
}) => {
  const email = `dos-pasos-${unique()}@test.local`;
  const password = 'contrasena-de-prueba';

  await crearCuentaYEmpresa(page, email, password);

  // ── La encuentra en Configuración, explicada en su idioma ─────────────────
  await page.getByRole('link', { name: /configuración/i }).click();

  const tarjeta = page.getByRole('heading', {
    name: 'Verificación en dos pasos',
  });
  await expect(tarjeta).toBeVisible();
  await expect(page.getByText(/código que cambia cada pocos segundos/i)).toBeVisible();
  await expect(page.getByText('Desactivada')).toBeVisible();

  // ── Activarla: QR, clave a mano y código ──────────────────────────────────
  await page.getByRole('button', { name: 'Activar', exact: true }).click();

  // El QR se ve de verdad, no es un hueco roto.
  const qr = page.getByAltText(/código para escanear/i);
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute('src', /^data:image\/png;base64,/);

  // La clave para escribir a mano existe: es la salida de quien no puede escanear.
  const clave = (await page.locator('code').first().innerText()).trim();
  expect(clave.replace(/\s/g, '')).toMatch(/^[A-Z2-7]{32}$/);

  await page.getByLabel('Código de 6 dígitos').fill(totp(clave));
  await page.getByRole('button', { name: /confirmar y activar/i }).click();

  // ── Los códigos de repuesto se enseñan UNA vez ────────────────────────────
  await expect(
    page.getByRole('heading', { name: /guarda estos códigos de repuesto/i }),
  ).toBeVisible();
  await expect(page.getByText(/no vamos a poder volver a enseñártelos/i)).toBeVisible();

  const codigos = await page.locator('ul.font-mono li').allInnerTexts();
  expect(codigos).toHaveLength(10);

  await page.getByRole('button', { name: /los he guardado/i }).click();
  // Y desaparecen de la pantalla.
  await expect(
    page.getByRole('heading', { name: /guarda estos códigos de repuesto/i }),
  ).toBeHidden();

  await expect(page.getByText('Activada', { exact: true })).toBeVisible();

  // ── Salir y volver a entrar: ahora hay un paso más ────────────────────────
  await page.getByRole('button', { name: /salir/i }).click();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();

  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  // La contraseña sola YA NO entra: aparece el segundo paso.
  await expect(page.getByRole('heading', { name: /un paso más/i })).toBeVisible();
  await expect(page.getByText(/aplicación de autenticación/i)).toBeVisible();
  // Y se le dice qué hacer si no tiene el móvil.
  await expect(page.getByText(/códigos de repuesto/i)).toBeVisible();

  // Un código equivocado no pasa, y lo dice sin tecnicismos.
  await page.getByLabel('Código', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText(/el código no es correcto/i)).toBeVisible();

  // El bueno, sí.
  await page.getByLabel('Código', { exact: true }).fill(totp(clave));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: /configuración/i })).toBeVisible();
});

test('confirmar la identidad antes de una acción delicada, sin vocabulario interno', async ({
  page,
}) => {
  const email = `reauth-${unique()}@test.local`;
  const password = 'contrasena-de-prueba';

  await crearCuentaYEmpresa(page, email, password);
  await page.getByRole('link', { name: /configuración/i }).click();

  // Cambiar la contraseña es una acción delicada: la primera vez pide confirmar identidad.
  await page.getByLabel('Contraseña nueva').fill('la-nueva-1234');
  await page.getByLabel('Repítela').fill('la-nueva-1234');
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();

  await expect(
    page.getByRole('heading', { name: /confirma que eres tú/i }),
  ).toBeVisible();
  // Sin segundo factor, lo que pide es la contraseña.
  const campo = page.getByLabel('Tu contraseña');
  await expect(campo).toBeVisible();

  await campo.fill(password);
  await page.getByRole('button', { name: 'Confirmar' }).click();

  // Y la acción se completa sola, sin tener que volver a pulsar el botón que ya se pulsó.
  await expect(page.getByText('Contraseña cambiada.')).toBeVisible();

  // ── Nada de vocabulario interno en toda la pantalla ───────────────────────
  const texto = await page.locator('body').innerText();
  for (const interno of [
    'TOTP',
    'MFA',
    'RECOVERY_CODES',
    'recovery_code',
    'mfaEnabled',
    'platform.',
    'reauthenticatedAt',
    'SUPERADMIN',
  ]) {
    expect(texto).not.toContain(interno);
  }
});

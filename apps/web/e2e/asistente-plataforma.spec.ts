import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@businessbrain/database';

/**
 * El asistente de operación, en un navegador de verdad.
 *
 * ## Qué demuestra esto que no demuestran las pruebas HTTP
 *
 * Que quien administra el producto puede USARLO. La API puede estar perfecta y la pantalla no
 * decir qué se puede preguntar, o esconder lo que el asistente consultó, o dejar el cuadro de
 * texto muerto mientras piensa. Nada de eso se ve desde `supertest`.
 *
 * Y comprueba la garantía que más importa enseñada: que la pantalla dice, ANTES de preguntar,
 * qué accesos hay abiertos y qué no puede hacer el asistente. Un asistente acotado que no
 * explica sus límites obliga a descubrirlos chocándose.
 *
 * ## El modelo está sustituido; el sistema, no
 *
 * El servidor de abajo emite la directiva de herramienta y luego una respuesta. Todo lo demás
 * —el catálogo cerrado, la comprobación de concesión, la traza— es el de producción. Que las
 * pruebas de ataque vivan en la suite HTTP y aquí solo el camino útil es deliberado: allí se
 * comprueba que el sistema aguanta un modelo hostil, aquí que una persona puede trabajar.
 */

const FAKE_OPENAI_PORT = Number(process.env.BB_FAKE_OPENAI_PORT ?? 4699);

function databaseUrl(): string {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const env = readFileSync(join(aqui, '..', '..', 'backend', '.env'), 'utf8');
  const match = /^DATABASE_URL=(.+)$/m.exec(env);
  if (!match) throw new Error('No hay DATABASE_URL en apps/backend/.env');
  return match[1].trim();
}

const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl() } },
});

const unique = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

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
  const digest = createHmac('sha1', Buffer.from(bytes)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
}

const RESPUESTA_FINAL =
  'Ahora mismo hay empresas registradas y ninguna cuenta bloqueada. Esto es un dato, no una interpretación mía. Siguiente paso: revisa las que llevan tiempo sin actividad. Tú decides.';

let openai: Server;

test.beforeAll(async () => {
  // El perfil de plataforma tiene que existir: es con lo que piensa el asistente, y nunca cae
  // al de ningún cliente. En producción lo crea el seed.
  const existente = await prisma.llmProfile.findFirst({
    where: { organizationId: null, isDefault: true },
  });
  if (!existente) {
    await prisma.llmProfile.create({
      data: {
        organizationId: null,
        provider: 'OPENAI',
        modelName: 'modelo-de-plataforma',
        isDefault: true,
      },
    });
  }

  /**
   * El modelo: primero pide una herramienta, después responde con lo que recibió.
   *
   * Se distinguen las dos vueltas por si el prompt ya lleva un resultado del sistema, que es
   * lo que hace que el servidor no dependa del orden en que se le llame.
   */
  openai = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const yaConsulto = body.includes('RESULTADO DEL SISTEMA');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: yaConsulto
                  ? RESPUESTA_FINAL
                  : 'Voy a mirarlo.\n[[BB_ASK]] {"tool":"platform_overview","input":{}}',
              },
            },
          ],
          usage: { total_tokens: 42 },
        }),
      );
    });
  });

  await new Promise<void>((resolve) =>
    openai.listen(FAKE_OPENAI_PORT, '127.0.0.1', resolve),
  );
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => openai.close(() => resolve()));
  await prisma.$disconnect();
});

test('el asistente dice qué puede hacer antes de que le pregunten, y enseña de dónde saca la respuesta', async ({
  page,
}) => {
  const email = `asistente-${unique()}@test.local`;
  const password = 'contrasena-de-prueba';

  // ── Una cuenta de operación, con su segundo factor activado por pantalla ──
  await page.goto('/login');
  await page.getByRole('button', { name: /crear una/i }).click();
  await page.getByLabel('Nombre').fill('Operación BusinessBrain');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(
    page.getByRole('heading', { name: /bienvenido a businessbrain/i }),
  ).toBeVisible();

  await prisma.user.update({
    where: { email },
    data: { platformRole: 'SUPERADMIN' },
  });

  await page.goto('/');
  await expect(page).toHaveURL(/\/platform$/);

  await page.getByRole('link', { name: 'Mi cuenta' }).click();
  await page.getByRole('button', { name: 'Activar', exact: true }).click();
  const clave = (await page.locator('code').first().innerText()).trim();
  await page.getByLabel('Código de 6 dígitos').fill(totp(clave));
  await page.getByRole('button', { name: /confirmar y activar/i }).click();
  await page.getByRole('button', { name: /los he guardado/i }).click();

  // ── El asistente ──────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Asistente' }).click();
  await expect(
    page.getByRole('heading', { name: 'Asistente de operación' }),
  ).toBeVisible();

  // Antes de preguntar nada, la pantalla ya dice qué puede y qué no.
  await expect(
    page.getByRole('heading', { name: 'Qué puede consultar' }),
  ).toBeVisible();
  await expect(page.getByText('El estado general de la plataforma')).toBeHidden();
  await expect(
    page.getByText(/cuántas empresas y personas hay en businessbrain/i),
  ).toBeVisible();

  // Y dice explícitamente lo que NO puede, que es lo que evita descubrirlo chocándose.
  await expect(
    page.getByRole('heading', { name: 'Qué no puede hacer' }),
  ).toBeVisible();
  await expect(
    page.getByText(/no puede leer los documentos de ninguna empresa/i),
  ).toBeVisible();
  await expect(page.getByText(/no existen esas capacidades/i)).toBeVisible();

  // Sin concesiones, lo dice en vez de dejar un hueco.
  await expect(
    page.getByText(/puede responderte sobre la plataforma, pero no sobre/i),
  ).toBeVisible();

  // Y ofrece por dónde empezar en vez de un cuadro vacío.
  await expect(
    page.getByRole('heading', { name: 'Por dónde empezar' }),
  ).toBeVisible();

  // ── Preguntar ─────────────────────────────────────────────────────────────
  await page
    .getByRole('button', { name: '¿Cómo está la plataforma ahora mismo?' })
    .click();

  await expect(page.getByText(/ninguna cuenta bloqueada/i)).toBeVisible();

  // Lo que consultó se ve debajo: es lo que hace la respuesta comprobable.
  await expect(page.getByText('Ha consultado')).toBeVisible();
  await expect(
    page.getByText('El estado general de la plataforma'),
  ).toBeVisible();

  // El protocolo interno NO llega a la pantalla.
  const pantalla = await page.locator('main').innerText();
  expect(pantalla).not.toContain('BB_ASK');
  expect(pantalla).not.toContain('platform_overview');
  expect(pantalla).not.toContain('RESULTADO DEL SISTEMA');
  // Ni un secreto, ni la clave del segundo factor.
  expect(pantalla).not.toContain(clave.replace(/\s/g, ''));
  expect(pantalla).not.toContain(password);

  // ── Y una empresa cliente no llega aquí ───────────────────────────────────
  await page.getByRole('button', { name: /salir/i }).click();
  await page.goto('/platform/assistant');
  await expect(page).toHaveURL(/\/login$/);
});

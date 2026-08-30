import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@businessbrain/database';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * La interfaz, comprobada como interfaz.
 *
 * ## Qué comprueba esto que no comprueba ninguna otra suite
 *
 * Las demás pruebas de navegador recorren FLUJOS: registrarse, subir un documento, preguntar,
 * conceder un acceso. Todas pueden pasar en un producto que, mirado, es inservible:
 *
 * - Una pantalla sin `<h1>`. Quien navega con lector de pantalla no sabe dónde está.
 * - Un título de pestaña idéntico en las once pantallas. Con cuatro pestañas abiertas, ninguna
 *   se distingue de las otras.
 * - Un menú que en un teléfono enseña cuatro secciones de once **sin ninguna pista de que
 *   existan las otras siete**. Media aplicación invisible, y quien la usa sin saberlo.
 * - "Mi cuenta" y "Configuración" mezcladas: nadie sabe si el idioma que cambia es suyo o de
 *   toda la empresa.
 * - Una cuenta de plataforma sin segundo factor recibida con dos cuadros rojos de error en vez
 *   de con la explicación de qué le falta.
 *
 * Ninguna de esas cinco cosas la ve una prueba HTTP, y ninguna la vio la suite de flujos: el
 * producto funcionaba y era, a la vez, imposible de usar. Esta suite mira lo que se ve.
 *
 * ## Y por qué el móvil tiene su propio recorrido
 *
 * Porque el fallo estaba SOLO ahí. A 1440 px la navegación se veía entera; a 375 px no, y no
 * había una sola prueba con ese ancho. Un ancho es una configuración del producto tanto como
 * un idioma.
 */

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

const PASSWORD = 'contrasena-de-prueba';

/**
 * El código de seis dígitos, calculado como lo calcularía el móvil de quien administra.
 *
 * RFC 6238 sobre el secreto en base32. Se implementa aquí en vez de importar el del backend
 * a propósito: si la prueba usara la misma función que el producto, un error compartido las
 * pondría de acuerdo a las dos.
 */
function totp(secretBase32: string): string {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const limpio = secretBase32.toUpperCase().replace(/[\s=]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let valor = 0;
  for (const caracter of limpio) {
    valor = (valor << 5) | alfabeto.indexOf(caracter);
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  const contador = Math.floor(Date.now() / 1000 / 30);
  const mensaje = Buffer.alloc(8);
  mensaje.writeUInt32BE(0, 0);
  mensaje.writeUInt32BE(contador >>> 0, 4);

  const digest = createHmac('sha1', Buffer.from(bytes)).update(mensaje).digest();
  const desplazamiento = digest[digest.length - 1] & 15;
  const truncado =
    ((digest[desplazamiento] & 127) << 24) |
    ((digest[desplazamiento + 1] & 255) << 16) |
    ((digest[desplazamiento + 2] & 255) << 8) |
    (digest[desplazamiento + 3] & 255);

  return String(truncado % 1_000_000).padStart(6, '0');
}

/** Una PYME recién creada, con su empresa, desde la interfaz. */
async function empresaNueva(page: Page): Promise<{ empresa: string }> {
  const empresa = `Panadería ${unique()}`;

  await page.goto('/login');
  await page.getByRole('button', { name: /crear una/i }).click();
  await page.getByLabel('Nombre').fill('Dueña de la PYME');
  await page.getByLabel('Correo').fill(`interfaz-${unique()}@test.local`);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(
    page.getByRole('heading', { name: /bienvenido a businessbrain/i }),
  ).toBeVisible();
  await page.getByLabel('Nombre de tu empresa').fill(empresa);
  await page.getByRole('button', { name: /crear mi empresa/i }).click();
  await expect(page.getByText('Primeros pasos')).toBeVisible();

  return { empresa };
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('cada pantalla dice dónde estás: un solo h1 y un título de pestaña propio', async ({
  page,
}) => {
  const { empresa } = await empresaNueva(page);

  // El panel se encabeza con el nombre de la EMPRESA, no con la palabra "Panel". Es la
  // respuesta a la primera pregunta de quien entra: ¿de quién son estos datos?
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(empresa);
  await expect(page).toHaveTitle('Panel · BusinessBrain');

  const pantallas: [string, RegExp, string][] = [
    ['Preguntar', /pregúntale a tu empresa/i, 'Preguntar · BusinessBrain'],
    ['Conocimiento', /conocimiento de tu empresa/i, 'Conocimiento · BusinessBrain'],
    ['Comprensión', /^comprensión$/i, 'Comprensión · BusinessBrain'],
    ['Objetivos', /^objetivos$/i, 'Objetivos · BusinessBrain'],
    ['Análisis', /^análisis$/i, 'Análisis · BusinessBrain'],
    ['Recomendaciones', /^recomendaciones$/i, 'Recomendaciones · BusinessBrain'],
    ['Automatizaciones', /^automatizaciones$/i, 'Automatizaciones · BusinessBrain'],
    ['Informes', /^informes$/i, 'Informes · BusinessBrain'],
    ['Mi cuenta', /^mi cuenta$/i, 'Mi cuenta · BusinessBrain'],
    ['Configuración', /configuración de la empresa/i, 'Configuración · BusinessBrain'],
  ];

  for (const [enlace, encabezado, titulo] of pantallas) {
    await page.getByRole('link', { name: enlace, exact: true }).click();

    // UNO. Dos `h1` en la misma pantalla dejan a un lector de pantalla sin saber cuál manda.
    const encabezados = page.getByRole('heading', { level: 1 });
    await expect(encabezados).toHaveCount(1);
    await expect(encabezados).toHaveText(encabezado);
    await expect(page).toHaveTitle(titulo);
  }
});

test('mi cuenta es de la persona y configuración es de la empresa', async ({
  page,
}) => {
  await empresaNueva(page);

  // Lo de la PERSONA: viaja con ella aunque mañana cambie de empresa.
  await page.getByRole('link', { name: 'Mi cuenta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Idioma' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /verificación en dos pasos/i }),
  ).toBeVisible();

  // Y NO lo de la empresa: si el perfil de IA se colara aquí, alguien creería que la clave y
  // el tope de gasto son suyos y no de toda la organización.
  await expect(
    page.getByRole('heading', { name: 'Inteligencia artificial', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /miembros/i })).toHaveCount(0);

  // Lo de la EMPRESA: se queda, y lo ve todo el equipo.
  await page.getByRole('link', { name: 'Configuración', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inteligencia artificial', exact: true }),
  ).toBeVisible();

  // Y NO lo de la persona: cambiar aquí la contraseña sugeriría que se cambia para todos.
  await expect(
    page.getByRole('heading', { name: /verificación en dos pasos/i }),
  ).toHaveCount(0);

  // Las cuatro secciones son navegables sin recorrer tres mil píxeles.
  await page.getByRole('button', { name: 'Equipo y accesos' }).click();
  await expect(page.getByRole('heading', { name: /miembros/i })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Inteligencia artificial', exact: true }),
  ).toHaveCount(0);
});

test('preguntar se ofrece: los ejemplos son botones que preguntan de verdad', async ({
  page,
}) => {
  await empresaNueva(page);
  await page.getByRole('link', { name: 'Preguntar', exact: true }).click();

  // El cuadro de pregunta es lo primero, y está vacío y disponible sin abrir nada.
  await expect(page.getByLabel('Tu pregunta')).toBeVisible();

  // Los ejemplos eran viñetas grises. Ahora son botones: quien entra por primera vez puede
  // ver una respuesta con sus fuentes sin teclear nada.
  const ejemplo = page.getByRole('button', {
    name: /qué acordamos con nuestro principal proveedor/i,
  });
  await expect(ejemplo).toBeVisible();

  // Y se dice ANTES de preguntar que no se va a inventar la respuesta.
  await expect(page.getByText(/lo dirá en lugar de inventarla/i)).toBeVisible();
});

test('conocimiento explica la cadena: fuentes, documentos, comprensión y respuestas', async ({
  page,
}) => {
  await empresaNueva(page);
  await page.getByRole('link', { name: 'Conocimiento', exact: true }).click();

  const cadena = page.getByRole('region', { name: /cómo funciona/i });
  for (const paso of ['Fuentes', 'Documentos', 'Comprensión', 'Respuestas']) {
    await expect(cadena.getByText(paso, { exact: true })).toBeVisible();
  }

  // Y los pasos van numerados en la propia pantalla: lo que hay que hacer primero, primero.
  await expect(page.getByText(/paso 1 · de dónde viene/i)).toBeVisible();
  await expect(page.getByText(/paso 2 · lo que ya ha entrado/i)).toBeVisible();
});

test('en un teléfono no hay ninguna sección escondida', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await empresaNueva(page);

  const menu = page.getByRole('button', { name: 'Menú' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');

  // Cerrado, la navegación no está en pantalla; es lo que hace imprescindible el botón.
  await expect(
    page.getByRole('link', { name: 'Informes', exact: true }),
  ).toHaveCount(0);

  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');

  // Las once entradas, TODAS. Antes se veían cuatro y no había forma de saber que faltaban.
  for (const seccion of [
    'Panel',
    'Preguntar',
    'Conocimiento',
    'Comprensión',
    'Objetivos',
    'Análisis',
    'Recomendaciones',
    'Automatizaciones',
    'Informes',
    'Mi cuenta',
    'Configuración',
  ]) {
    await expect(
      page.getByRole('link', { name: seccion, exact: true }),
    ).toBeVisible();
  }

  // Al navegar se cierra solo. Dejarlo abierto tapa la pantalla a la que se acaba de llegar.
  await page.getByRole('link', { name: 'Conocimiento', exact: true }).click();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    /conocimiento de tu empresa/i,
  );

  // Y con Escape se cierra devolviendo el foco al botón: quien navega con teclado no se queda
  // tecleando dentro de un menú que ya no está.
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
});

/**
 * Las siete pantallas del panel de operación, con su encabezado y su título de pestaña.
 *
 * La suite de la Fase 8 comprobó esto en el producto de cliente y dejó el panel fuera. No es
 * una pantalla interna sin consecuencias: es donde se administra la plataforma entera, quien
 * la usa la tiene abierta todo el día en varias pestañas, y `/platform/account` es además la
 * única puerta para activar el segundo factor.
 */
test('el panel de operación también dice dónde estás en cada una de sus pantallas', async ({
  page,
}) => {
  const email = `panel-${unique()}@test.local`;

  await page.goto('/login');
  await page.getByRole('button', { name: /crear una/i }).click();
  await page.getByLabel('Nombre').fill('Operación BusinessBrain');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(
    page.getByRole('heading', { name: /bienvenido a businessbrain/i }),
  ).toBeVisible();

  // No existe ruta para concederse el rol de plataforma, y no debe existir.
  await prisma.user.update({
    where: { email },
    data: { platformRole: 'SUPERADMIN' },
  });

  // Sin segundo factor solo se llega a la cuenta, así que se activa primero: es la puerta.
  await page.goto('/platform/account');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Mi cuenta' }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Mi cuenta · BusinessBrain');

  await page.getByRole('button', { name: 'Activar', exact: true }).click();
  const clave = (await page.locator('code').first().innerText()).trim();
  await page.getByLabel('Código de 6 dígitos').fill(totp(clave));
  await page.getByRole('button', { name: /confirmar y activar/i }).click();
  await page.getByRole('button', { name: /los he guardado/i }).click();

  for (const [enlace, encabezado, titulo] of [
    ['Inicio', 'Estado de la plataforma', 'Inicio · BusinessBrain'],
    ['Asistente', 'Asistente de operación', 'Asistente · BusinessBrain'],
    ['Empresas', 'Empresas', 'Empresas · BusinessBrain'],
    ['Personas', 'Personas', 'Personas · BusinessBrain'],
    ['Mis accesos', 'Mis accesos', 'Mis accesos · BusinessBrain'],
    ['Registro', 'Registro de administración', 'Registro · BusinessBrain'],
    ['Mi cuenta', 'Mi cuenta', 'Mi cuenta · BusinessBrain'],
  ] as const) {
    await page.getByRole('link', { name: enlace, exact: true }).click();

    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText(encabezado);
    await expect(page).toHaveTitle(titulo);
    await expect(page.getByRole('main')).toBeVisible();
  }
});

test('a quien administra la plataforma sin segundo factor se le explica, no se le da un error', async ({
  page,
}) => {
  const email = `sin-mfa-${unique()}@test.local`;

  await page.goto('/login');
  await page.getByRole('button', { name: /crear una/i }).click();
  await page.getByLabel('Nombre').fill('Operación sin segundo factor');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(
    page.getByRole('heading', { name: /bienvenido a businessbrain/i }),
  ).toBeVisible();

  // No hay ruta para concederse el rol de plataforma, y no debe haberla.
  await prisma.user.update({
    where: { email },
    data: { platformRole: 'SUPERADMIN' },
  });

  await page.goto('/platform');

  // Antes esto eran dos cuadros rojos que decían "no tienes permiso": literalmente cierto y
  // completamente inútil, porque el permiso lo tenía y lo que faltaba era el segundo factor.
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /activa la verificación en dos pasos/i,
    }),
  ).toBeVisible();
  await expect(page.getByText(/no tienes permiso/i)).toHaveCount(0);
  await expect(page.getByText(/problema momentáneo de conexión/i)).toHaveCount(0);

  // Y desde aquí se puede ir a activarlo, que es lo único que queda por hacer.
  await page.getByRole('link', { name: 'Activarla ahora' }).click();
  await expect(page).toHaveURL(/\/platform\/account$/);
  await expect(
    page.getByRole('button', { name: 'Activar', exact: true }),
  ).toBeVisible();
});

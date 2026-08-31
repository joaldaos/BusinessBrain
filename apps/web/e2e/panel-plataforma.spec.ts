import { expect, test, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@businessbrain/database';

/**
 * El panel de operación, recorrido entero en un navegador de verdad.
 *
 * ## Qué demuestra esto que no demuestra ninguna prueba HTTP
 *
 * Que el camino EXISTE para una persona. La API puede estar perfecta y el panel no tener botón
 * para pedir un acceso, o tenerlo detrás de un estado que nunca se pinta, o enseñar el
 * contenido de un cliente en una pantalla donde no tocaba. Nada de eso se ve desde `supertest`.
 *
 * Y demuestra la garantía que más importa de esta fase: que **el valor real de un secreto no
 * aparece en el DOM**. No se comprueba que un campo no exista —eso ya lo hacen las pruebas
 * estructurales— sino que la cadena concreta que serviría para suplantar a alguien no está en
 * la página.
 *
 * ## Sin atajos
 *
 * No hay mocks, ni skips, ni `si existe entonces`. Cada paso depende de que el anterior haya
 * ocurrido: si pedir acceso no funcionara, el paso siguiente no encontraría la tabla y la
 * prueba fallaría, no se saltaría.
 *
 * La única concesión es cómo NACE la cuenta de administración: no existe ruta para concederse
 * el rol de plataforma —y no debe existir—, así que se promociona en la base de datos. Todo lo
 * demás, incluido activar la verificación en dos pasos, se hace por la interfaz.
 */

/**
 * La MISMA base de datos que el backend que levanta Playwright.
 *
 * El proceso de las pruebas no hereda `DATABASE_URL` —el backend la lee de su propio `.env` al
 * arrancar— así que se lee de ahí en vez de escribirla otra vez aquí. Dos cadenas de conexión
 * que tienen que coincidir acaban separándose, y separarse significaría promocionar la cuenta
 * en una base de datos distinta de la que sirve el panel: la prueba fallaría diciendo algo que
 * no es.
 */
function databaseUrl(): string {
  // `import.meta.url` y no `__dirname`: las especificaciones se cargan como módulos ES.
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

/** TOTP (RFC 6238): lo mismo que hace la aplicación del móvil con la clave escaneada. */
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

/** Crea una cuenta y su empresa desde la interfaz, con contenido real dentro. */
async function empresaCliente(page: Page): Promise<{
  nombre: string;
  email: string;
  documento: string;
}> {
  const email = `cliente-${unique()}@test.local`;
  const nombre = `Distribuciones ${unique()}`;
  const documento = 'El descuento máximo autorizado es del quince por ciento.';

  await page.goto('/login');
  await page.getByRole('button', { name: /crear una/i }).click();
  await page.getByLabel('Nombre').fill('Dueña de la PYME');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill('contrasena-de-prueba');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(
    page.getByRole('heading', { name: /bienvenido a businessbrain/i }),
  ).toBeVisible();
  await page.getByLabel(/nombre de tu empresa/i).fill(nombre);
  await page.getByRole('button', { name: /crear/i }).click();
  await expect(page.getByRole('link', { name: /configuración/i })).toBeVisible();

  /*
    Un documento de VERDAD, subido desde la interfaz. Sin él, "el administrador no ve el
    contenido" pasaría por no haber contenido que ver — que es exactamente la clase de prueba
    que aprueba por casualidad.
  */
  await page.getByRole('link', { name: 'Conocimiento', exact: true }).click();
  await page.getByLabel('Nueva colección').fill('Comercial');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(
    page.locator('span').filter({ hasText: /^Comercial$/ }),
  ).toBeVisible();

  // El formulario de nueva fuente se abre desde su acción: no está siempre desplegado.
  await page.getByRole('button', { name: 'Añadir una fuente' }).click();
  await page.getByLabel('Nueva fuente').fill('Mis documentos');
  await page
    .getByLabel('Colección de destino')
    .selectOption({ label: 'Comercial' });
  await page.getByRole('button', { name: /crear fuente/i }).click();
  await expect(page.getByText('Mis documentos')).toBeVisible();

  const subida = page.waitForResponse(
    (response) =>
      response.url().includes('/sync') && response.request().method() === 'POST',
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: 'politica-descuentos.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(documento, 'utf8'),
  });
  expect((await subida).ok()).toBe(true);
  await expect(page.getByText(/ya está dentro y se puede preguntar/i)).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: /salir/i }).click();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();

  return { nombre, email, documento };
}

/** Una cuenta de administración de plataforma, con su segundo factor activado por pantalla. */
async function administrador(
  page: Page,
): Promise<{ email: string; password: string; secret: string }> {
  const email = `operacion-${unique()}@test.local`;
  const password = 'contrasena-de-prueba';

  await page.goto('/login');
  await page.getByRole('button', { name: /crear una/i }).click();
  await page.getByLabel('Nombre').fill('Operación BusinessBrain');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  // Se espera a que el registro haya TERMINADO antes de tocar la base de datos: pulsar el
  // botón dispara registro y sesión, y promocionar la cuenta a mitad la busca antes de que
  // exista.
  await expect(
    page.getByRole('heading', { name: /bienvenido a businessbrain/i }),
  ).toBeVisible();

  // No existe ruta para concederse el rol de plataforma, y no debe existir.
  await prisma.user.update({
    where: { email },
    data: { platformRole: 'SUPERADMIN' },
  });

  // Al recargar, la sesión ya es de plataforma: el panel debe recibirle sin pasar por la
  // pantalla de "crea tu empresa", que para él es un callejón sin salida.
  await page.goto('/');
  await expect(page).toHaveURL(/\/platform$/);

  // El segundo factor es obligatorio para administrar, y se activa desde SU pantalla de
  // cuenta dentro del panel: la configuración de cliente le está cerrada, y debe estarlo.
  await page.getByRole('link', { name: 'Mi cuenta' }).click();
  await page.getByRole('button', { name: 'Activar', exact: true }).click();
  const clave = (await page.locator('code').first().innerText()).trim();
  await page.getByLabel('Código de 6 dígitos').fill(totp(clave));
  await page.getByRole('button', { name: /confirmar y activar/i }).click();
  await expect(
    page.getByRole('heading', { name: /guarda estos códigos de repuesto/i }),
  ).toBeVisible();
  await page.getByRole('button', { name: /los he guardado/i }).click();

  return { email, password, secret: clave };
}

/** Rellena el diálogo de confirmar identidad, si está en pantalla. */
async function confirmarIdentidad(page: Page, secret: string): Promise<void> {
  const dialogo = page.getByRole('heading', { name: /confirma que eres tú/i });
  await expect(dialogo).toBeVisible();
  await page.getByLabel('Código de tu aplicación').fill(totp(secret));
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('quien opera BusinessBrain administra la plataforma sin ser dueño de los datos de nadie', async ({
  page,
}) => {
  // ── 0. Una empresa cliente con contenido, y una cuenta de operación ────────
  const cliente = await empresaCliente(page);
  const admin = await administrador(page);

  // ── 1-2. Entrar como administración y llegar al panel ──────────────────────
  await page.getByRole('button', { name: /salir/i }).click();
  await page.getByLabel('Correo').fill(admin.email);
  await page.getByLabel('Contraseña').fill(admin.password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Con segundo factor: la contraseña sola no entra.
  await expect(page.getByRole('heading', { name: /un paso más/i })).toBeVisible();
  await page.getByLabel('Código', { exact: true }).fill(totp(admin.secret));
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL(/\/platform$/);

  // ── 3. El panel dice desde la primera línea qué es y qué no ────────────────
  await expect(
    page.getByRole('heading', { name: 'Estado de la plataforma' }),
  ).toBeVisible();
  await expect(
    page.getByText(/los datos de cada empresa siguen siendo suyos/i),
  ).toBeVisible();
  await expect(
    page.getByText('No tienes ningún acceso abierto a los datos de ninguna empresa.'),
  ).toBeVisible();

  // ── 4-6. Empresas: buscar la del cliente y abrirla ─────────────────────────
  await page.getByRole('link', { name: 'Empresas', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Empresas', exact: true }),
  ).toBeVisible();

  await page.getByLabel('Buscar').fill(cliente.nombre);
  await expect(page.getByText(cliente.nombre)).toBeVisible();
  await page.getByText(cliente.nombre).click();

  await expect(page.getByRole('heading', { name: cliente.nombre })).toBeVisible();

  // Los tres alcances están, separados, y los tres cerrados.
  for (const alcance of ['Datos generales', 'Diagnóstico', 'Contenido']) {
    await expect(page.getByRole('heading', { name: alcance })).toBeVisible();
  }
  await expect(page.getByText('Sin acceso')).toHaveCount(3);

  // Y sin acceso, el documento del cliente NO está en la página.
  expect(await page.locator('body').innerText()).not.toContain(
    cliente.documento,
  );

  // ── 7-9. Pedir DATOS GENERALES, reautenticarse, comprobar ─────────────────
  await page
    .getByRole('button', { name: 'Pedir acceso a los datos generales' })
    .click();
  await expect(
    page.getByText(/no verás el contenido de ningún documento/i).first(),
  ).toBeVisible();
  await page
    .getByLabel('Por qué lo necesitas')
    .fill('El cliente dice que no le entra nada y hay que ver su estado.');
  await page
    .getByRole('button', { name: 'Pedir acceso a los datos generales' })
    .nth(1)
    .click();

  await confirmarIdentidad(page, admin.secret);

  // Queda abierto y ENSEÑA los metadatos: recuentos y fuentes.
  await expect(page.getByText('Acceso activo')).toBeVisible();
  await expect(page.getByText('Colecciones').first()).toBeVisible();

  // ── 10-11. DIAGNÓSTICO es independiente: sigue cerrado ────────────────────
  await expect(page.getByText('Sin acceso')).toHaveCount(2);

  await page
    .getByRole('button', { name: 'Pedir acceso al diagnóstico' })
    .click();
  await page
    .getByLabel('Por qué lo necesitas')
    .fill('Comprobando si alguna sincronización está fallando.');
  await page
    .getByRole('button', { name: 'Pedir acceso al diagnóstico' })
    .nth(1)
    .click();

  await expect(page.getByText('Acceso activo')).toHaveCount(2);
  // Y el contenido SIGUE cerrado: ningún alcance arrastra a otro.
  await expect(page.getByText('Sin acceso')).toHaveCount(1);
  expect(await page.locator('body').innerText()).not.toContain(
    cliente.documento,
  );

  // ── 12-13. CONTENIDO: se pide, y NO se concede solo ───────────────────────
  await page.getByRole('button', { name: 'Pedir acceso al contenido' }).click();
  // La pantalla explica lo que va a ocurrir antes de que haya nada que confirmar.
  await expect(page.getByText(/queda pendiente y no se abre nada/i)).toBeVisible();
  await page
    .getByLabel('Por qué lo necesitas')
    .fill('Un documento no se indexa y hay que ver qué tiene dentro.');
  await page
    .getByRole('button', { name: 'Pedir acceso al contenido' })
    .nth(1)
    .click();

  await expect(page.getByText('Esperando a la empresa')).toBeVisible();
  // Lo decisivo: pedirlo NO lo abre, y los otros dos no se han tocado.
  expect(await page.locator('body').innerText()).not.toContain(
    cliente.documento,
  );
  await expect(page.getByText('Acceso activo')).toHaveCount(2);

  // ── 14. La superficie permitida sí se ve ──────────────────────────────────
  await expect(page.getByText('Últimas sincronizaciones')).toBeVisible();

  // ── 15-19. Personas: una acción sensible con reautenticación ──────────────
  await page.getByRole('link', { name: 'Personas' }).click();
  await expect(
    page.getByText(/consultar esta lista queda registrado/i),
  ).toBeVisible();

  await page.getByLabel('Buscar por nombre o correo').fill(cliente.email);
  await page.getByText(cliente.email).click();

  await expect(page.getByRole('heading', { name: 'Dueña de la PYME' })).toBeVisible();

  await page.getByRole('button', { name: 'Bloquear la cuenta' }).click();
  await expect(
    page.getByText(/dejará de poder entrar inmediatamente/i),
  ).toBeVisible();
  await expect(
    page.getByText(/quedará registrada con tu nombre/i),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Bloquear la cuenta' }).nth(1).click();

  /*
    Aquí NO vuelve a pedir la identidad, y eso es lo que hay que comprobar.

    La ventana de quince minutos de la Fase 4 se abrió al pedir el primer acceso y cubre las
    acciones siguientes: es exactamente el objetivo declarado —no obligar a introducir la
    credencial en cada acción consecutiva— y sin afirmarlo aquí, un cambio que la rompiera
    pasaría desapercibido.
  */
  await expect(
    page.getByRole('heading', { name: /confirma que eres tú/i }),
  ).toBeHidden();
  await expect(page.getByText('Bloqueada')).toBeVisible();

  // Se deshace, para no dejar al cliente fuera del resto del recorrido.
  await page.getByRole('button', { name: 'Desbloquear la cuenta' }).click();
  await page
    .getByRole('button', { name: 'Desbloquear la cuenta' })
    .nth(1)
    .click();
  await expect(page.getByText('Activa')).toBeVisible();

  // ── 20-22. El registro: aparece lo hecho, y ningún secreto ────────────────
  await page.getByRole('link', { name: 'Registro' }).click();
  await expect(
    page.getByRole('heading', { name: 'Registro de administración' }),
  ).toBeVisible();

  /*
    Se busca dentro de la LISTA, no en la página: el desplegable de filtros contiene los
    mismos rótulos como opciones, y un locator sin acotar los encontraría ahí — pasando la
    prueba sin que la acción estuviera registrada.
  */
  const listado = page.locator('ol');
  for (const accion of [
    'Bloqueó una cuenta',
    'Desbloqueó una cuenta',
    'Pidió acceso a los datos de una empresa',
  ]) {
    await expect(listado.getByText(accion).first()).toBeVisible();
  }

  const registro = await page.locator('body').innerText();
  // El valor REAL del secreto de la cuenta, no el nombre del campo.
  expect(registro).not.toContain(admin.secret);
  expect(registro).not.toContain(admin.password);
  expect(registro).not.toContain(cliente.documento);
  // Y ni el correo del actor, que la API no devuelve.
  expect(registro).not.toContain(admin.email);
  for (const prohibido of [
    'passwordHash',
    'mfaSecretEnc',
    'tokenHash',
    'contentText',
    'memberships',
  ]) {
    expect(registro).not.toContain(prohibido);
  }

  // ── 23-25. Mis accesos: están los dos, y se retira uno ────────────────────
  await page.getByRole('link', { name: 'Mis accesos' }).click();
  await expect(
    page.getByText(/tener un acceso no es pertenecer a esa empresa/i),
  ).toBeVisible();

  await expect(page.getByText('Datos generales')).toBeVisible();
  await expect(page.getByText('Diagnóstico')).toBeVisible();

  await page.getByRole('button', { name: 'Retirar este acceso' }).first().click();
  await page
    .getByRole('button', { name: 'Retirar este acceso' })
    .nth(1)
    .click();

  // Pasa a "Terminados" y ya no se puede consultar.
  await expect(page.getByText('Terminados')).toBeVisible();
  await expect(page.getByText('Retirado').first()).toBeVisible();

  // ── 26-27. Salir, y el panel deja de ser accesible ────────────────────────
  await page.getByRole('button', { name: /salir/i }).click();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();

  await page.goto('/platform');
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole('heading', { name: 'Estado de la plataforma' }),
  ).toBeHidden();
});

test('una empresa cliente no puede entrar en el panel de operación', async ({
  page,
}) => {
  // La puerta de verdad está en el backend; esto comprueba que quien la encuentre por la URL
  // recibe un no claro en vez de una pantalla rota llena de errores.
  const cliente = await empresaCliente(page);

  await page.goto('/login');
  await page.getByLabel('Correo').fill(cliente.email);
  await page.getByLabel('Contraseña').fill('contrasena-de-prueba');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Se espera a que la sesión esté DENTRO antes de navegar: sin esto, el `goto` corre contra
  // el inicio de sesión y la prueba mediría una carrera, no el producto.
  await expect(page.getByRole('link', { name: 'Conocimiento' })).toBeVisible();

  await page.goto('/platform');
  await expect(page).toHaveURL(/localhost:5173\/$/);
  await expect(page.getByRole('link', { name: 'Conocimiento' })).toBeVisible();
  await expect(page.getByText('Operación')).toBeHidden();
});

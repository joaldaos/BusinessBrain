import { expect, test, type Page } from '@playwright/test';

/**
 * Objetivos, Análisis, Automatizaciones e Informes, comprobadas como pantallas.
 *
 * ## Qué comprueba esto
 *
 * Que las cuatro se pueden USAR sin que nadie te las explique. No que compilen, no que
 * respondan 200: que quien entra sepa qué está viendo, qué significa y qué hacer.
 *
 * Cada una se recorre vacía y con datos, porque son dos productos distintos. Una pantalla
 * vacía es lo primero que ve TODO cliente nuevo y hasta la Fase 8.1 decía cosas como "Ninguno
 * todavía." — cinco palabras que no explican qué es un objetivo, para qué sirve ni qué hacer
 * a continuación.
 *
 * ## Y qué NO comprueba
 *
 * Ni una clase CSS. Si mañana cambia el color de un botón, esta suite no se entera y hace
 * bien: lo que defiende es el comportamiento, no la hoja de estilos.
 */

const PASSWORD = 'contrasena-de-prueba';

const unique = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Una PYME recién creada, con su empresa, desde la interfaz. */
async function empresaNueva(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: /crear una/i }).click();
  await page.getByLabel('Nombre').fill('Dueña de la PYME');
  await page.getByLabel('Correo').fill(`operativas-${unique()}@test.local`);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(
    page.getByRole('heading', { name: /bienvenido a businessbrain/i }),
  ).toBeVisible();
  await page.getByLabel('Nombre de tu empresa').fill(`Ferretería ${unique()}`);
  await page.getByRole('button', { name: /crear mi empresa/i }).click();
  await expect(page.getByText('Primeros pasos')).toBeVisible();
}

/**
 * Nada se sale por la derecha.
 *
 * A 375 px una tabla ancha o una fila que no envuelve empuja la página entera y deja media
 * pantalla fuera. Se nota enseguida usándolo y no lo detecta ninguna prueba de las que ya
 * existían, porque el DOM está perfecto: lo que falla es el ancho.
 */
async function sinDesbordeHorizontal(page: Page): Promise<void> {
  const desborde = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(desborde, 'la página se sale por la derecha').toBeLessThanOrEqual(1);
}

/**
 * Va a una sección, esté la barra a la vista o escondida en el menú.
 *
 * Por debajo de 1024 px la navegación completa no cabe —once secciones— y vive detrás del
 * botón. Una prueba que asuma una de las dos formas solo comprueba media aplicación.
 */
async function irA(page: Page, enlace: string): Promise<void> {
  const menu = page.getByRole('button', { name: 'Menú' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: enlace, exact: true }).click();
}

const PANTALLAS = [
  ['Objetivos', /^objetivos$/i, 'Objetivos · BusinessBrain'],
  ['Análisis', /^análisis$/i, 'Análisis · BusinessBrain'],
  [
    'Automatizaciones',
    /^automatizaciones$/i,
    'Automatizaciones · BusinessBrain',
  ],
  ['Informes', /^informes$/i, 'Informes · BusinessBrain'],
] as const;

test('las cuatro se alcanzan desde el menú, con su título y un solo h1', async ({
  page,
}) => {
  await empresaNueva(page);

  for (const [enlace, encabezado, titulo] of PANTALLAS) {
    await page.getByRole('link', { name: enlace, exact: true }).click();

    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText(encabezado);
    await expect(page).toHaveTitle(titulo);

    // Los puntos de referencia que usa un lector de pantalla para saltar por la página.
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('navigation').first()).toBeVisible();
  }
});

test('vacías, las cuatro explican qué son y qué hacer a continuación', async ({
  page,
}) => {
  await empresaNueva(page);

  // ── Objetivos ─────────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Objetivos', exact: true }).click();
  await expect(
    page.getByText(/todavía no le has dicho a businessbrain qué quieres conseguir/i),
  ).toBeVisible();
  // Qué es y para qué sirve, no "Ninguno todavía."
  await expect(
    page.getByText(/es una frase corta con lo que quieres lograr/i),
  ).toBeVisible();
  // Con un ejemplo real, que es lo que quita el miedo a la página en blanco.
  await expect(page.getByText(/el margen comercial no debe bajar/i)).toBeVisible();
  // Y UNA acción principal, no un formulario abierto compitiendo con el texto.
  await expect(
    page.getByRole('button', { name: 'Crear objetivo' }),
  ).toHaveCount(1);

  // ── Análisis ──────────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Análisis', exact: true }).click();
  await expect(
    page.getByText(/businessbrain todavía no ha analizado tu empresa/i),
  ).toBeVisible();

  // Y aquí NO se ofrece analizar.
  //
  // Sin documentos ni objetivos, un análisis termina bien y no encuentra nada. Ofrecer el
  // botón sería mandar a alguien a un callejón sin salida y dejarle creyendo que el producto
  // no funciona. Lo que se ofrece es el paso que sí lleva a algún sitio.
  await expect(page.getByRole('button', { name: 'Analizar ahora' })).toHaveCount(
    0,
  );
  await expect(
    page.getByText(/qué necesita para poder analizar/i),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Ir a Conocimiento' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Ir a Objetivos' }),
  ).toBeVisible();

  // ── Automatizaciones ──────────────────────────────────────────────────────
  await page
    .getByRole('link', { name: 'Automatizaciones', exact: true })
    .click();
  await expect(
    page.getByText(/todavía no hay nada que se haga solo/i),
  ).toBeVisible();
  await expect(page.getByText(/nunca envía nada al exterior/i)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Crear automatización' }),
  ).toHaveCount(1);

  // ── Informes ──────────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Informes', exact: true }).click();
  await expect(
    page.getByText(/todavía no has creado ningún informe/i),
  ).toBeVisible();
  await expect(page.getByText(/reúne en un pdf/i)).toBeVisible();
  // Sin conocimiento leído se dice también, porque el informe saldría vacío.
  await expect(
    page.getByText(/necesitas al menos un documento leído/i),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear informe' })).toHaveCount(
    1,
  );
});

test('la acción principal de Objetivos crea uno, lo confirma en pantalla y lo lista', async ({
  page,
}) => {
  await empresaNueva(page);
  await page.getByRole('link', { name: 'Objetivos', exact: true }).click();

  // Desde el estado vacío, sin tener que buscar el formulario.
  await page.getByRole('button', { name: 'Crear objetivo' }).click();
  await page
    .getByLabel('Objetivo')
    .fill('El margen comercial no debe bajar del 30 %.');
  await page.getByRole('button', { name: 'Declarar' }).click();

  // Qué ha ocurrido, dicho: un formulario que se cierra en silencio hace dudar de si funcionó.
  // En una región anunciada, no en un párrafo cualquiera: quien no mira la pantalla
  // también tiene que enterarse de que se ha creado.
  await expect(
    page.getByRole('status').filter({ hasText: /objetivo creado/i }),
  ).toBeVisible();

  // Y el resultado, arriba, con su estado en palabras.
  await expect(
    page.getByText('El margen comercial no debe bajar del 30 %.'),
  ).toBeVisible();
  await expect(page.getByText('confirmado')).toBeVisible();
  await expect(page.getByText(/lo dijo una persona/i)).toBeVisible();

  // El formulario ya no está: crear no es lo que se hace cada vez que se entra aquí.
  await expect(page.getByLabel('Objetivo')).toHaveCount(0);
  // Y la acción para crear otro vive ahora en la cabecera.
  await expect(page.getByRole('button', { name: 'Crear objetivo' })).toBeVisible();

  await sinDesbordeHorizontal(page);
});

test('un informe dice qué lleva dentro, no cuántas secciones tiene', async ({
  page,
}) => {
  await empresaNueva(page);
  await page.getByRole('link', { name: 'Informes', exact: true }).click();

  await page.getByRole('button', { name: 'Crear informe' }).click();
  await page.getByLabel('Nombre del informe').fill('Resumen para la gestoría');
  await page.getByLabel(/añadir una búsqueda/i).fill('devoluciones');
  await page.getByRole('button', { name: 'Guardar informe' }).click();

  await expect(page.getByText('Resumen para la gestoría')).toBeVisible();
  await expect(
    page.getByText(/lo que businessbrain ha comprendido/i),
  ).toBeVisible();
  await expect(
    page.getByText(/lo que encuentre sobre «devoluciones»/i),
  ).toBeVisible();
  await expect(page.getByText(/todavía no lo has generado/i)).toBeVisible();

  // La acción principal de un informe es descargarlo: para eso existe.
  await expect(page.getByRole('button', { name: /descargar pdf/i })).toBeVisible();

  // El aviso de alcance se dice una vez, arriba, no repetido en cada tarjeta.
  await expect(page.getByText(/depende de tu alcance/i)).toHaveCount(1);
});

test('una automatización dice cuándo se ejecuta sin enseñar una expresión de cron', async ({
  page,
}) => {
  await empresaNueva(page);
  await page
    .getByRole('link', { name: 'Automatizaciones', exact: true })
    .click();

  await page.getByRole('button', { name: 'Crear automatización' }).click();
  await page.getByLabel('Nombre').fill('Barrido de los lunes');
  await page.getByRole('button', { name: 'Guardar automatización' }).click();

  await expect(page.getByText('Barrido de los lunes')).toBeVisible();
  await expect(page.getByText('Cada lunes a las 8:00')).toBeVisible();
  // Lo que hace, en castellano.
  await expect(page.getByText('analizar', { exact: true })).toBeVisible();
  await expect(page.getByText(/todavía no se ha ejecutado/i)).toBeVisible();

  // Y nada de vocabulario interno en toda la pantalla.
  const texto = await page.getByRole('main').innerText();
  expect(texto).not.toMatch(/0 8 \* \* 1/);
  expect(texto).not.toMatch(/RUN_ANALYSIS|SYNC_KNOWLEDGE_SOURCE|GENERATE_REPORT/);

  // Las ejecuciones se despliegan, y el botón dice si están abiertas.
  const ver = page.getByRole('button', { name: 'Ejecuciones' });
  await expect(ver).toHaveAttribute('aria-expanded', 'false');
  await ver.click();
  await expect(page.getByText(/sin ejecuciones todavía/i)).toBeVisible();
});

test('cuando la API falla, lo dice con palabras y ofrece reintentar', async ({
  page,
}) => {
  await empresaNueva(page);

  // Se rompe la llamada a propósito. Un error de servidor es un estado de la pantalla como
  // cualquier otro, y hasta ahora ninguna prueba lo había mirado nunca.
  await page.route('**/api/business-objectives', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Internal server error' }),
    }),
  );

  await page.getByRole('link', { name: 'Objetivos', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText(
    /no hemos podido cargar esto/i,
  );
  // Y no se filtra la prosa del servidor, que está en un idioma fijo y no ayuda a nadie.
  await expect(page.getByText(/internal server error/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
});

test('en un teléfono las cuatro se usan enteras y nada se sale por la derecha', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await empresaNueva(page);

  for (const [enlace, encabezado] of PANTALLAS) {
    await irA(page, enlace);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      encabezado,
    );
    await sinDesbordeHorizontal(page);

    // La acción principal se ve sin buscarla: en móvil cae debajo del título, no fuera.
    const principal = page
      .getByRole('button', { name: /^crear/i })
      .first();
    if (await principal.isVisible()) {
      const caja = await principal.boundingBox();
      expect(caja?.width ?? 0).toBeGreaterThan(0);
      // Un botón de menos de 32 px de alto no se acierta con el dedo.
      expect(caja?.height ?? 0).toBeGreaterThanOrEqual(32);
    }
  }
});

test('a 768 y a 1440 tampoco hay desbordes, y el formulario es navegable con el teclado', async ({
  page,
}) => {
  await empresaNueva(page);

  // 1024 entra a propósito: es justo el ancho al que aparece la barra completa con sus once
  // secciones, y si alguna vez no cupieran, se desbordaría exactamente ahí.
  for (const ancho of [768, 1024, 1440]) {
    await page.setViewportSize({ width: ancho, height: 900 });
    for (const [enlace] of PANTALLAS) {
      await irA(page, enlace);
      await sinDesbordeHorizontal(page);
    }
  }

  // Teclado: se llega al campo tabulando y lo que se escribe llega donde toca. Un formulario
  // que solo se puede rellenar con el ratón deja fuera a quien no lo usa.
  await irA(page, 'Objetivos');
  await page.getByRole('button', { name: 'Crear objetivo' }).click();

  const campo = page.getByLabel('Objetivo');
  await expect(campo).toBeFocused();
  await page.keyboard.type('Cobrar a treinta días como máximo.');
  await expect(campo).toHaveValue('Cobrar a treinta días como máximo.');

  // Y desde el campo se alcanza el botón de enviar tabulando, sin trampas de orden.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Declarar' })).toBeFocused();
});

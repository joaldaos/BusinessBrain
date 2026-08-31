/**
 * Monta el escenario de demostración de BusinessBrain sobre una base limpia.
 *
 * ## Qué construye
 *
 * Una PYME de verdad —una panadería— con todo lo que hace falta para enseñar el recorrido
 * completo: empresa, colección, fuente, dos documentos, una pregunta con su respuesta y sus
 * fuentes, un objetivo, un análisis, sus conclusiones, sus recomendaciones, un informe y una
 * automatización.
 *
 * ## Lo que NO hace
 *
 * No escribe en la base de datos, no toca Prisma y no se salta ningún permiso: todo pasa por
 * la API pública, con la sesión de una persona normal. Si mañana una regla de seguridad
 * cambia, esta demo deja de funcionar — y eso es exactamente lo que queremos, porque
 * significa que lo que se enseña es el producto y no una maqueta.
 *
 * No inventa datos: los documentos son ficheros de texto que se suben de verdad, y las
 * conclusiones, las recomendaciones y la respuesta las produce el sistema.
 *
 * ## La clave de IA
 *
 * Sale de `OPENAI_API_KEY` en el entorno y nunca se escribe aquí ni se imprime. Sin ella se
 * monta igualmente todo lo que no depende del modelo, y al final se dice exactamente qué ha
 * quedado fuera.
 *
 * Uso:
 *   node --env-file=apps/backend/.env scripts/demo.mjs
 *
 * Ver `docs/DEMO.md`.
 */

import { randomBytes } from 'node:crypto';

const API = process.env.BB_API_URL ?? 'http://localhost:3999';
const EMAIL = process.env.BB_DEMO_EMAIL ?? 'ana@panaderia-ruiz.demo';
/**
 * La contraseña de la cuenta de demostración.
 *
 * Sale del entorno o se genera al azar en cada ejecución. NO hay ninguna escrita aquí: este
 * fichero está en el repositorio, y una contraseña en el repositorio es una contraseña
 * publicada — aunque la cuenta se llame "demo" y aunque el escenario sea de prueba.
 *
 * Se enseña al terminar, una vez. Si quieres una fija —para volver a entrar mañana sin
 * repetir el montaje— pásala en `BB_DEMO_PASSWORD`.
 */
const PASSWORD =
  process.env.BB_DEMO_PASSWORD ??
  `${randomBytes(12).toString('base64url')}Aa1!`;
const CLAVE_IA = process.env.OPENAI_API_KEY;

const EMPRESA = 'Panadería Ruiz';
const COLECCION = 'Comercial';
const FUENTE = 'Documentos de ventas';

/** Los documentos de la panadería. Texto plano: es un formato que el producto acepta. */
const DOCUMENTOS = [
  {
    nombre: 'politica-de-descuentos.txt',
    texto: [
      'POLÍTICA DE DESCUENTOS COMERCIALES',
      '',
      'La política de descuentos comerciales fija un máximo del quince por ciento para el',
      'canal mayorista. Cualquier descuento superior exige autorización expresa del',
      'responsable de área, registrada por escrito antes de trasladar la oferta al cliente.',
      '',
      'El margen comercial objetivo de la compañía para el ejercicio en curso es del treinta',
      'por ciento. Los descuentos aplicados por el equipo comercial no deben comprometerlo.',
      '',
      'El anexo segundo recoge las condiciones de devolución acordadas con cada distribuidor,',
      'incluyendo los plazos máximos de aceptación y el procedimiento de reclamación.',
    ].join('\n'),
  },
  {
    nombre: 'condiciones-de-entrega.txt',
    texto: [
      'CONDICIONES DE ENTREGA Y PLAZOS',
      '',
      'La propuesta comercial contempla un plazo de entrega de treinta días naturales desde',
      'la firma del contrato, con penalización por cada semana de retraso.',
      '',
      'Las devoluciones se aceptan durante los catorce días siguientes a la entrega, siempre',
      'que el producto conserve su embalaje original y se comunique por escrito.',
    ].join('\n'),
  },
];

const PREGUNTA = '¿Cuál es nuestro descuento máximo para mayoristas?';
const OBJETIVO = 'El margen comercial no debe bajar del 30 %.';
const INFORME = 'Resumen para la gestoría';
const AUTOMATIZACION = 'Barrido de los lunes';

// ── Utilidades ───────────────────────────────────────────────────────────────

let acceso = null;
let organizacion = null;

const paso = (texto) => console.log(`\n▸ ${texto}`);
const ok = (texto) => console.log(`  ✓ ${texto}`);
const aviso = (texto) => console.log(`  ! ${texto}`);

/**
 * Una llamada a la API con la sesión y la organización activas.
 *
 * Un fallo se cuenta entero —ruta, estado y cuerpo—: una demo que muere diciendo "error 400"
 * obliga a abrir el navegador para averiguar qué pasó.
 */
async function llamar(ruta, opciones = {}) {
  const cabeceras = { ...(opciones.headers ?? {}) };
  if (acceso) cabeceras.Authorization = `Bearer ${acceso}`;
  if (organizacion) cabeceras['x-org-id'] = organizacion;
  if (opciones.body && !(opciones.body instanceof FormData)) {
    cabeceras['content-type'] = 'application/json';
  }

  const respuesta = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: cabeceras,
    body:
      opciones.body instanceof FormData
        ? opciones.body
        : opciones.body
          ? JSON.stringify(opciones.body)
          : undefined,
  });

  const texto = await respuesta.text();
  const cuerpo = texto ? JSON.parse(texto) : null;

  if (!respuesta.ok) {
    throw new Error(
      `${opciones.method ?? 'GET'} ${ruta} respondió ${respuesta.status}: ${texto.slice(0, 300)}`,
    );
  }

  return cuerpo?.data ?? cuerpo;
}

// ── El recorrido ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`BusinessBrain · escenario de demostración\nAPI: ${API}`);

  paso('Comprobando que el servidor responde');
  const salud = await fetch(`${API}/health`).catch(() => null);
  if (!salud?.ok) {
    throw new Error(
      `El backend no responde en ${API}. Arráncalo antes (ver docs/DEMO.md).`,
    );
  }
  ok('el backend está en pie');

  // ── 1. La persona y su empresa ─────────────────────────────────────────────
  paso('Creando la cuenta y la empresa');
  try {
    await llamar('/auth/register', {
      method: 'POST',
      body: { email: EMAIL, password: PASSWORD, name: 'Ana Ruiz' },
    });
    ok(`cuenta creada: ${EMAIL}`);
  } catch (error) {
    // Volver a lanzar la demo sobre la misma base no debe romperla.
    if (!String(error).includes('409')) throw error;
    aviso('la cuenta ya existía; se reutiliza');
  }

  const sesion = await llamar('/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
  });
  acceso = sesion.accessToken;

  /*
   * No hay ruta que liste "mis organizaciones", y es deliberado: `/auth/me` devuelve las
   * membresías y cada organización se resuelve por su propia ruta, que vuelve a comprobar la
   * membresía del lado correcto. La demo hace lo mismo que hace la interfaz.
   */
  const yo = await llamar('/auth/me');
  let existente = null;
  for (const membresia of yo.memberships ?? []) {
    const org = await llamar(`/organizations/${membresia.organizationId}`);
    if (org.name === EMPRESA) existente = org;
  }
  organizacion =
    existente?.id ??
    (await llamar('/organizations', { method: 'POST', body: { name: EMPRESA } }))
      .id;
  ok(`empresa lista: ${EMPRESA}`);

  // ── 2. La inteligencia artificial ──────────────────────────────────────────
  paso('Configurando la inteligencia artificial');
  if (!CLAVE_IA) {
    aviso('sin OPENAI_API_KEY: se salta, y con ella se saltan pregunta y análisis');
  } else {
    await llamar('/ai-configuration', {
      method: 'POST',
      body: { provider: 'OPENAI', apiKey: CLAVE_IA },
    });
    ok('clave guardada y comprobada (no se imprime ni se guarda en el repositorio)');
  }

  // ── 3. Colección y fuente ──────────────────────────────────────────────────
  paso('Creando la colección y la fuente');
  const colecciones = await llamar('/knowledge-collections');
  const coleccion =
    colecciones.find((c) => c.name === COLECCION) ??
    (await llamar('/knowledge-collections', {
      method: 'POST',
      body: { name: COLECCION },
    }));
  ok(`colección: ${coleccion.name}`);

  const fuentes = await llamar('/knowledge-sources');
  const fuente =
    fuentes.find((f) => f.name === FUENTE) ??
    (await llamar('/knowledge-sources', {
      method: 'POST',
      body: {
        name: FUENTE,
        type: 'FILE_UPLOAD',
        connectorKey: 'file_upload_v1',
        config: {},
        knowledgeCollectionIds: [coleccion.id],
      },
    }));
  ok(`fuente: ${fuente.name}`);

  // ── 4. Los documentos ──────────────────────────────────────────────────────
  paso('Subiendo los documentos de la panadería');
  for (const documento of DOCUMENTOS) {
    const formulario = new FormData();
    formulario.append(
      'file',
      new Blob([documento.texto], { type: 'text/plain' }),
      documento.nombre,
    );
    const resultado = await llamar(`/knowledge-sources/${fuente.id}/sync`, {
      method: 'POST',
      body: formulario,
    });
    const creados = resultado?.stats?.itemsCreated ?? 0;
    ok(`${documento.nombre}: ${creados > 0 ? 'dentro' : 'ya estaba'}`);
  }

  // ── 5. El objetivo ─────────────────────────────────────────────────────────
  paso('Declarando el objetivo de la empresa');
  const objetivos = await llamar('/business-objectives');
  if (!objetivos.some((o) => o.statement === OBJETIVO)) {
    await llamar('/business-objectives', {
      method: 'POST',
      body: { statement: OBJETIVO },
    });
  }
  ok(OBJETIVO);

  /*
   * La exigencia de fiabilidad, alta a propósito.
   *
   * Con el listón por defecto, un análisis sobre dos documentos recién leídos no encuentra
   * nada que contar y la demo se queda sin la parte más vistosa. Subiéndolo, el motor detecta
   * de verdad que esos documentos quedan por debajo de lo que la empresa exige — que es un
   * escenario real: una asesoría o una clínica ponen el listón así.
   */
  paso('Subiendo la exigencia de fiabilidad de la empresa');
  await llamar(`/organizations/${organizacion}`, {
    method: 'PATCH',
    body: {
      settings: { knowledgeEngine: { confidence: { minimumFloor: 0.95 } } },
    },
  });
  ok('exigencia al 0,95: el sistema avisará de lo que no la alcance');

  // ── 6. La pregunta ─────────────────────────────────────────────────────────
  if (CLAVE_IA) {
    paso('Haciendo la primera pregunta');
    const conversacion = await llamar('/conversations', {
      method: 'POST',
      body: { title: PREGUNTA.slice(0, 80) },
    });
    const respuesta = await llamar(
      `/conversations/${conversacion.id}/messages`,
      { method: 'POST', body: { content: PREGUNTA } },
    );
    ok(`respondida con ${respuesta.citations?.length ?? 0} fuentes citadas`);

    // ── 7. El análisis ───────────────────────────────────────────────────────
    paso('Lanzando el análisis');
    const analisis = await llamar('/analysis-runs', { method: 'POST', body: {} });
    ok(
      `${analisis.insightsCreated ?? 0} conclusiones nuevas · ` +
        `${analisis.recommendationsProposed ?? 0} recomendaciones propuestas`,
    );
  }

  // ── 8. El informe ──────────────────────────────────────────────────────────
  paso('Creando el informe');
  const informes = await llamar('/reports');
  if (!informes.some((r) => r.name === INFORME)) {
    await llamar('/reports', {
      method: 'POST',
      body: {
        name: INFORME,
        template: {
          sections: [
            { type: 'INSIGHTS', title: 'Qué hemos comprendido', limit: 10 },
            {
              type: 'KNOWLEDGE_SEARCH',
              title: 'Sobre: devoluciones',
              query: 'devoluciones',
              limit: 10,
            },
          ],
        },
      },
    });
  }
  ok(INFORME);

  // ── 9. La automatización ───────────────────────────────────────────────────
  paso('Creando la automatización');
  const automatizaciones = await llamar('/automations');
  if (!automatizaciones.some((a) => a.name === AUTOMATIZACION)) {
    await llamar('/automations', {
      method: 'POST',
      body: {
        name: AUTOMATIZACION,
        triggerType: 'SCHEDULE',
        triggerConfig: { cron: '0 8 * * 1', timezone: 'Europe/Madrid' },
        actions: [{ type: 'RUN_ANALYSIS' }],
      },
    });
  }
  ok(`${AUTOMATIZACION} · cada lunes a las 8:00`);

  // ── Y cómo entrar ──────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────');
  console.log('Escenario montado. Entra con:');
  console.log(`  correo:     ${EMAIL}`);
  console.log(
    process.env.BB_DEMO_PASSWORD
      ? '  contraseña: la de BB_DEMO_PASSWORD'
      : `  contraseña (SOLO se enseña ahora, no se guarda): ${PASSWORD}`,
  );
  if (!CLAVE_IA) {
    console.log('\nSIN pregunta respondida y SIN análisis: falta OPENAI_API_KEY.');
    console.log('Con la clave puesta, vuelve a lanzarlo y se completan los dos.');
  }
  console.log('─────────────────────────────────────────────');
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
});

/**
 * Qué sale de BusinessBrain hacia el proveedor de IA, y qué se guarda aquí.
 *
 * ## Por qué esto es código y no un texto en una pantalla
 *
 * Una empresa que sube sus contratos tiene derecho a saber que ese texto viaja a un tercero.
 * Escribirlo como prosa en la interfaz habría bastado hoy y habría envejecido mal: cada vez que
 * alguien añada una llamada nueva al modelo, el aviso se quedaría corto sin que nada avise. Y
 * un aviso de privacidad desactualizado es peor que no tenerlo, porque afirma algo falso.
 *
 * Así que la lista vive aquí, junto al código, y una prueba estructural (`data-flow.spec.ts`)
 * comprueba que no hay en el repositorio ninguna llamada al proveedor que no esté declarada.
 * Añadir una llamada nueva rompe esa prueba y obliga a decir en voz alta qué sale.
 *
 * ## Lo que NO hace este fichero
 *
 * No es asesoramiento legal ni un contrato de encargado de tratamiento. Es la descripción
 * técnica y verificable de un flujo de datos: el material a partir del cual alguien con
 * criterio jurídico redacta lo que haya que redactar. Esa parte queda explícitamente pendiente.
 */

export interface AiDataFlow {
  /** Fichero que hace la llamada. Es lo que ancla la declaración al código real. */
  callSite: string;
  /** Qué sale, dicho para una persona que no ha escrito código en su vida. */
  what: string;
  /** Qué lo provoca. */
  trigger: string;
}

/**
 * Todas las salidas hacia el proveedor de IA configurado por la empresa.
 *
 * Si esta lista y el código dejan de coincidir, la prueba estructural falla.
 */
export const AI_PROVIDER_DATA_FLOWS: AiDataFlow[] = [
  {
    callSite: 'conversations/send-message.use-case.ts',
    what: 'Tu pregunta y los fragmentos de tus documentos que se han encontrado para responderla.',
    trigger: 'Cada vez que alguien pregunta algo.',
  },
  {
    callSite: 'conversations/stream-message.use-case.ts',
    what: 'Lo mismo que al preguntar, cuando la respuesta se va escribiendo sobre la marcha.',
    trigger: 'Cada vez que alguien pregunta algo.',
  },
  {
    callSite: 'knowledge-engine/application/classify-content.use-case.ts',
    what: 'Un fragmento de cada documento, para saber de qué área de la empresa trata.',
    trigger: 'Al incorporar un documento nuevo.',
  },
  {
    callSite: 'knowledge-engine/application/chunk-and-embed.use-case.ts',
    what: 'El texto completo de cada documento, troceado, para poder buscarlo después.',
    trigger: 'Al incorporar un documento nuevo.',
  },
  {
    callSite: 'knowledge-engine/application/retrieve-context.use-case.ts',
    what: 'El texto de la búsqueda, para poder compararlo con tus documentos.',
    trigger: 'Cada vez que se busca algo en tu conocimiento.',
  },
  {
    callSite:
      'understanding-engine/infrastructure/strategies/generative-synthesis.strategy.ts',
    what: 'El contenido de los documentos que se están analizando.',
    trigger: 'Al lanzar un análisis.',
  },
  {
    callSite:
      'understanding-engine/application/propose-from-insights.use-case.ts',
    what: 'Las conclusiones del análisis, para redactar una recomendación.',
    trigger: 'Al lanzar un análisis.',
  },
  {
    callSite: 'llm/application/ai-configuration.service.ts',
    what: 'Una frase de prueba, sin datos tuyos, para comprobar que la clave funciona.',
    trigger: 'Al guardar la configuración de la IA.',
  },
];

/** Qué guarda BusinessBrain, dicho igual de claro. */
export const STORED_DATA: { what: string; detail: string }[] = [
  {
    what: 'Los documentos que subes o que se leen de tus fuentes',
    detail:
      'Su texto completo, para poder responder con citas. Se guarda en la base de datos de BusinessBrain.',
  },
  {
    what: 'Las preguntas y respuestas',
    detail: 'Para que puedas volver a una conversación anterior.',
  },
  {
    what: 'Las conclusiones y recomendaciones',
    detail:
      'Con la evidencia de la que salen, para que siempre se puedan comprobar.',
  },
  {
    what: 'Quién hace qué',
    detail:
      'Nombre, correo y las decisiones que toma cada persona sobre una recomendación.',
  },
  {
    what: 'Tu clave del proveedor de IA',
    detail:
      'Cifrada. No se puede leer desde la interfaz ni vuelve nunca en una respuesta.',
  },
];

/**
 * Lo que todavía NO está resuelto y necesita una decisión que no es técnica.
 *
 * Se dice en la propia interfaz en vez de callarlo. Un cliente que pregunta por el contrato de
 * encargado de tratamiento y recibe un silencio se lleva una impresión peor que uno que recibe
 * "todavía no, y lo sabemos".
 */
export const PENDING_LEGAL: string[] = [
  'El contrato de encargado de tratamiento con el proveedor de IA depende de con cuál trabaje cada empresa y de una revisión jurídica. Todavía no se entrega desde aquí.',
  'El plazo de conservación de los datos tras una baja no está fijado: hoy, si pides el borrado, se borra en ese momento.',
];

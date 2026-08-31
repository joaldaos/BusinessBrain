/**
 * Una conclusión, contada como se la contaría un asesor.
 *
 * ## Por qué esto vive en el dominio y no en el renderizador
 *
 * Porque no es una decisión de presentación: es **qué significa** una señal del motor en
 * términos de negocio. Un `CONFIDENCE_DECAYED` quiere decir que un documento ha dejado de
 * alcanzar el listón que puso la empresa, y eso es cierto en el PDF, en la pantalla y en
 * cualquier sitio donde se cuente.
 *
 * El motor compone y persiste su propio resumen:
 *
 * > «La confianza de "politica-descuentos.pdf" cayó a 0.64, por debajo del umbral 0.95
 * > configurado por la organización. Dejó de ser recuperable por defecto.»
 *
 * Es exacto, y es lo correcto para una traza. Lo que no es, es entregable a la gestoría de una
 * panadería. Este módulo NO lo sustituye: lo traduce para el nivel principal y deja el
 * original para el anexo, que es donde se comprueba.
 *
 * ## La regla que no se puede romper
 *
 * **Cuando no se sabe, no se inventa.** Si la traza no dice de qué clase de hallazgo se trata,
 * o falta el dato con el que se compuso, se devuelve el resumen del motor tal cual. Un texto
 * feo es mejor que uno bonito que afirme algo que nadie ha comprobado — y en un PDF que va a
 * una asesoría, mucho peor.
 *
 * Lo que redactó el modelo a partir de los documentos de la empresa (`GENERATIVE`) ya está en
 * lenguaje de negocio y es contenido suyo: se respeta sin tocarlo.
 *
 * ## Y por qué está duplicado con la interfaz
 *
 * `apps/web/src/insights/lenguaje.ts` hace lo mismo para la pantalla. No comparten código
 * porque no comparten proceso ni sistema de idiomas: el PDF se redacta en castellano en el
 * servidor y la pantalla se traduce en el navegador. Lo que sí comparten es la lista de
 * señales, y hay una prueba en cada lado que exige cubrirlas todas.
 */

/** Las señales que el Knowledge Engine expone y este módulo sabe contar. */
export const SEÑALES_NARRABLES = [
  'CONFIDENCE_DECAYED',
  'SOURCE_DISCONNECTED',
  'CANONICALIZATION_UNRESOLVED',
] as const;

export type SeñalNarrable = (typeof SEÑALES_NARRABLES)[number];

/** Lo que una persona necesita leer, en el orden en que lo necesita. */
export interface NarrativaDeConclusion {
  /** Qué ha pasado, en una frase. */
  titular: string;
  /** Qué ha detectado el sistema. Nulo cuando solo se sabe el titular. */
  detectado: string | null;
  /** Por qué le importa a la empresa. Nulo cuando el sistema no puede afirmarlo. */
  porQueImporta: string | null;
  /** Qué conviene hacer. Nulo cuando no hay una acción concreta que proponer. */
  queHacer: string | null;
}

/** Lo mínimo que hace falta para contar una conclusión. */
export interface ConclusionNarrable {
  summary: string;
  reasoningTrace?: unknown;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor : null;
}

function numero(valor: unknown): number | null {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * La traza, leída con desconfianza.
 *
 * Es una columna JSON que escribe cada estrategia: puede ser nula, puede venir de una versión
 * anterior del motor y puede tener cualquier forma. Nada de lo que hay dentro se da por hecho.
 */
function leerTraza(traza: unknown): {
  estrategia: string | null;
  señal: string | null;
  hechos: Record<string, unknown>;
} {
  if (!traza || typeof traza !== 'object') {
    return { estrategia: null, señal: null, hechos: {} };
  }

  const objeto = traza as Record<string, unknown>;
  const hechos =
    objeto.facts && typeof objeto.facts === 'object'
      ? (objeto.facts as Record<string, unknown>)
      : {};

  return {
    estrategia: texto(objeto.strategyKind),
    señal: texto(objeto.signalKind),
    hechos,
  };
}

export function narrarConclusion(
  insight: ConclusionNarrable,
): NarrativaDeConclusion {
  /** La salida segura: lo que dijo el motor, sin adornos. */
  const literal: NarrativaDeConclusion = {
    titular: insight.summary,
    detectado: null,
    porQueImporta: null,
    queHacer: null,
  };

  const { estrategia, señal, hechos } = leerTraza(insight.reasoningTrace);

  // Lo que redactó el modelo sobre los documentos de la empresa ya habla como una persona.
  if (estrategia === 'GENERATIVE') return literal;

  switch (señal) {
    case 'CONFIDENCE_DECAYED': {
      const documento = texto(hechos.title);
      if (!documento) return literal;
      return {
        titular: `«${documento}» ya no ofrece la seguridad que pide vuestra empresa.`,
        detectado:
          'Ha dejado de alcanzar el nivel de fiabilidad que la empresa exige para usar un ' +
          'documento como referencia.',
        porQueImporta:
          'Mientras siga así, BusinessBrain no lo usará para responder preguntas.',
        queHacer: 'Revisar el documento o volver a subirlo actualizado.',
      };
    }

    case 'SOURCE_DISCONNECTED': {
      const fuente = texto(hechos.name);
      if (!fuente) return literal;
      const afectados = numero(hechos.affectedKnowledgeItems) ?? 0;
      return {
        titular: `La fuente «${fuente}» ha dejado de traer información.`,
        detectado:
          'Está desconectada o dando error, así que lo que llegaba por ella ya no se ' +
          'actualiza.',
        // Solo se afirma el impacto cuando el sistema sabe a cuánto alcanza.
        porQueImporta:
          afectados > 0
            ? `Hay ${afectados} documentos que dependen de ella y se están quedando desfasados.`
            : null,
        queHacer: 'Volver a conectarla desde la pantalla de Conocimiento.',
      };
    }

    case 'CANONICALIZATION_UNRESOLVED': {
      const cuantos = numero(hechos.candidateCount);
      if (cuantos === null || cuantos <= 0) return literal;
      return {
        titular: `${cuantos} documentos dicen cosas distintas sobre lo mismo.`,
        detectado:
          'BusinessBrain no puede determinar por su cuenta cuál de ellos prevalece.',
        porQueImporta:
          'Hasta que alguien lo decida, las respuestas sobre este punto pueden quedarse ' +
          'incompletas.',
        queHacer:
          'Revisar los documentos implicados y dejar vigente el que corresponda.',
      };
    }

    default:
      return literal;
  }
}

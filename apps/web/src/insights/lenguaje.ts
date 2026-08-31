import type { Insight } from '../api/types';
import { useT, type TranslationKey } from '../i18n';

/**
 * Una conclusión, contada como se la contaría un asesor.
 *
 * ## El problema
 *
 * El motor compone el resumen de una conclusión con su propio vocabulario, y lo persiste:
 *
 * > «La confianza de "politica-descuentos.pdf" cayó a 0.64, por debajo del umbral 0.95
 * > configurado por la organización. Dejó de ser recuperable por defecto.»
 *
 * Es exacto y es inútil para quien lleva una panadería. Peor: al lado aparecía «fiabilidad
 * alta» —que es la seguridad de la CONCLUSIÓN, un 0.90— y el conjunto se lee como una
 * contradicción, porque las dos cosas se llaman igual y solo una está explicada.
 *
 * ## Lo que hace este módulo, y lo que NO hace
 *
 * No reescribe nada en el servidor y no adivina. Coge los HECHOS que el motor ya guarda en
 * `reasoningTrace` —qué clase de hallazgo es y con qué datos se detectó— y los dice en
 * castellano corriente. Los mismos datos, la misma afirmación, otras palabras.
 *
 * Cuando la conclusión la redactó el modelo a partir de los documentos de la empresa
 * (`strategyKind: 'GENERATIVE'`), el resumen YA está en lenguaje de negocio y es contenido de
 * la empresa: se muestra tal cual. Traducirlo sería reescribir lo que la empresa ha
 * comprendido.
 *
 * Y cuando la traza no dice de qué se trata —una estrategia nueva, una conclusión antigua—
 * **no se inventa un titular**: se enseña el resumen del motor. Un texto feo es mejor que un
 * texto bonito que afirme algo que el sistema no sabe.
 *
 * ## Dos niveles
 *
 * Lo que devuelve esto es el NIVEL 1: qué ha pasado, por qué importa y qué hacer. El resumen
 * literal del motor, los números y la evidencia siguen estando, en el nivel 2, para quien
 * quiera comprobarlo. No se pierde nada: se ordena.
 */

/** Lo que una persona necesita leer, en el orden en que lo necesita. */
export interface Hallazgo {
  /** Qué ha pasado, en una frase. */
  titular: string;
  /** Qué ha detectado el sistema exactamente. Nulo si solo sabemos el titular. */
  detectado: string | null;
  /** Por qué le importa a la empresa. Nulo si el sistema no puede afirmarlo. */
  porQueImporta: string | null;
  /** Dónde se resuelve. Nulo cuando no hay una pantalla concreta a la que ir. */
  accion: { texto: string; a: string } | null;
}

/** El texto de un hecho, cuando viene y es texto. */
function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor : null;
}

/** Un número de un hecho, cuando viene y es un número. */
function numero(valor: unknown): number | null {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export function useHallazgo(): (insight: Insight) => Hallazgo {
  const t = useT();

  return (insight: Insight): Hallazgo => {
    const traza = insight.reasoningTrace ?? null;
    const hechos = traza?.facts ?? {};

    /** El resumen del motor, que es siempre la salida segura. */
    const literal: Hallazgo = {
      titular: insight.summary,
      detectado: null,
      porQueImporta: null,
      accion: null,
    };

    // Lo que redactó el modelo sobre los documentos de la empresa ya habla como una persona.
    if (traza?.strategyKind === 'GENERATIVE') return literal;

    const clave = (sufijo: string) =>
      `insight.finding.${traza?.signalKind}.${sufijo}` as TranslationKey;

    switch (traza?.signalKind) {
      case 'CONFIDENCE_DECAYED': {
        const documento = texto(hechos.title);
        if (!documento) return literal;
        return {
          titular: t(clave('title'), { document: documento }),
          detectado: t(clave('detected')),
          porQueImporta: t(clave('matters')),
          accion: { texto: t('insight.finding.goKnowledge'), a: '/conocimiento' },
        };
      }

      case 'SOURCE_DISCONNECTED': {
        const fuente = texto(hechos.name);
        if (!fuente) return literal;
        const afectados = numero(hechos.affectedKnowledgeItems) ?? 0;
        return {
          titular: t(clave('title'), { source: fuente }),
          detectado: t(clave('detected')),
          // Solo se afirma el impacto cuando el sistema sabe a cuántos documentos alcanza.
          porQueImporta:
            afectados > 0 ? t(clave('matters'), { count: afectados }) : null,
          accion: { texto: t('insight.finding.goKnowledge'), a: '/conocimiento' },
        };
      }

      case 'CANONICALIZATION_UNRESOLVED': {
        const cuantos = numero(hechos.candidateCount);
        if (cuantos === null || cuantos <= 0) return literal;
        return {
          titular: t(clave('title'), { count: cuantos }),
          detectado: t(clave('detected')),
          porQueImporta: t(clave('matters')),
          accion: { texto: t('insight.finding.goKnowledge'), a: '/conocimiento' },
        };
      }

      default:
        return literal;
    }
  };
}

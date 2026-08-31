import { useCallback, useMemo } from 'react';
import { useI18n, type TranslationKey } from './index';

/**
 * El vocabulario interno del sistema, dicho en el idioma de quien mira.
 *
 * ## Por qué esto existe en vez de traducir en cada pantalla
 *
 * El backend habla con constantes —`INDEXED`, `ANOMALY`, `SUPERSEDED`, `OWNER`— porque un
 * catálogo cerrado es lo correcto para un modelo de datos. Pero pintarlas tal cual pone en la
 * pantalla de una panadería palabras que no significan nada, en un idioma que además puede no
 * ser el suyo.
 *
 * La traducción vive en un solo sitio para que no derive: con `INDEXED` traducido en tres
 * pantallas distintas, la cuarta acaba enseñando la constante. Ya ocurrió una vez.
 *
 * ## Un valor desconocido se devuelve tal cual
 *
 * Si el backend empieza a mandar un estado nuevo, aparece su nombre en bruto — feo, visible, y
 * arreglable. Lo que no puede pasar es que se caiga la pantalla o que aparezca la clave de
 * traducción, que no le dice nada a nadie.
 */
export function useLabels() {
  const { t } = useI18n();

  const traducir = useCallback(
    (familia: string, valor: string | null | undefined): string => {
      if (!valor) return t('common.none');

      const clave = `status.${familia}.${valor}` as TranslationKey;
      const texto = t(clave);
      // `t` devuelve la clave cuando no la conoce. Ahí es mejor el valor original.
      return texto === clave ? valor : texto;
    },
    [t],
  );

  return useMemo(
    () => ({
      /** Estado de un documento dentro del motor de conocimiento. */
      knowledgeItemStatus: (v: string | null | undefined) =>
        traducir('knowledgeItem', v),
      /** Qué clase de conclusión es. */
      insightType: (v: string | null | undefined) => traducir('insightType', v),
      /** Si una conclusión sigue siendo comprobable. No es "está mal". */
      freshness: (v: string | null | undefined) => traducir('freshness', v),
      /** Resultado de una ejecución: análisis, sincronización, informe o automatización. */
      runStatus: (v: string | null | undefined) => traducir('run', v),
      /** Estado de una fuente o de una conexión externa. */
      connectionStatus: (v: string | null | undefined) =>
        traducir('connection', v),
      /** Qué puede hacer una persona dentro de la empresa. */
      role: (v: string | null | undefined) => traducir('role', v),
      /** Estado de una automatización. */
      automationStatus: (v: string | null | undefined) =>
        traducir('automation', v),
      /** Ciclo de vida de una conclusión. */
      insightStatus: (v: string | null | undefined) => traducir('insight', v),
      /** Si una propuesta está pendiente de decisión o ya se decidió. */
      recommendationStatus: (v: string | null | undefined) =>
        traducir('recommendation', v),

      /**
       * La fiabilidad, en palabras.
       *
       * El motor trabaja con un número entre 0 y 1 y es lo correcto: se compara, se ordena y
       * se pone un listón. Pero "confianza 0.57" en pantalla no dice nada. ¿0.57 es bueno?
       * ¿Es malo? ¿Comparado con qué? Nadie lleva en la cabeza la escala de un motor de
       * comprensión, y la respuesta además depende de la exigencia que haya puesto la propia
       * empresa.
       *
       * Tres tramos: es lo que una persona necesita para decidir si se fía o lo comprueba.
       * Los cortes son los del propio producto —0.7 es el suelo por defecto de recuperación—
       * y no una escala inventada aquí.
       */
      /**
       * De qué clase es una pieza de evidencia: un documento, un pasaje, otra conclusión.
       *
       * Se usa solo cuando NO se ha podido resolver el nombre real. Con nombre, el nombre
       * gana siempre: "politica-descuentos.pdf" dice más que "un documento".
       */
      evidenceKind: (v: string | null | undefined) => traducir('evidenceKind', v),
      /** Qué papel juega esa pieza: la sostiene, la contradice, es lo que se desvió. */
      evidenceRole: (v: string | null | undefined) => traducir('evidenceRole', v),

      confidence: (valor: number | null | undefined): string => {
        if (valor == null) return t('common.none');
        if (valor >= 0.85) return t('common.confidence.high');
        if (valor >= 0.7) return t('common.confidence.medium');
        return t('common.confidence.low');
      },
    }),
    [traducir, t],
  );
}

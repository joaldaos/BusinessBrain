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
    }),
    [traducir],
  );
}

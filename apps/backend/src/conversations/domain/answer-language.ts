import { localeEndonym, type Locale } from '../../common/i18n/locales';

/**
 * En qué idioma responde BusinessBrain, y qué NO puede tocar al hacerlo.
 *
 * ## El idioma de la interfaz y el del conocimiento son cosas distintas
 *
 * Una asesoría de Girona puede querer el producto en catalán, tener los contratos en
 * castellano y recibir facturas en inglés. Esas tres cosas no tienen por qué coincidir nunca, y
 * el producto sería inservible si exigiera que coincidieran.
 *
 * Así que la regla es simple y no admite matices: **se responde en el idioma de quien
 * pregunta, sea cual sea el idioma de los documentos.**
 *
 * ## Y lo que se cita se cita tal cual
 *
 * Esto es lo que de verdad importa y por eso ocupa la mitad de la instrucción. Un fragmento
 * traducido dentro de una respuesta deja de ser evidencia: quien lo lee no puede ir al
 * documento y encontrarlo, y una cifra o un nombre propio mal traducidos convierten una
 * respuesta correcta en una decisión equivocada. "El máximo es del 15%" traducido de un
 * contrato inglés y luego citado como si fuera literal es peor que no responder.
 *
 * El contenido de las fuentes NO se traduce en ningún punto del sistema: ni al incorporarlo,
 * ni al vectorizarlo, ni al citarlo. Lo único que cambia de idioma es lo que BusinessBrain
 * escribe de su cosecha.
 */

/**
 * La instrucción que viaja en el prompt.
 *
 * Va escrita en castellano —como el resto del prompt— pero nombra el idioma destino en su
 * propia lengua ("responde en English"), que es la forma menos ambigua de pedirlo. Y se repite
 * en el propio idioma destino: un modelo que va a responder en inglés obedece mejor una
 * instrucción en inglés, y repetirla no cuesta nada.
 */
export function answerLanguageDirective(locale: Locale): string {
  const nombre = localeEndonym(locale);

  return [
    `IDIOMA DE LA RESPUESTA: escribe SIEMPRE en ${nombre}, aunque los documentos estén en otro idioma. ${ANSWER_IN[locale]}`,
    'NO TRADUZCAS lo que cites. Los fragmentos, los nombres propios, las cifras, las fechas y ' +
      'las referencias se reproducen exactamente como aparecen en el documento original: quien ' +
      'lea la respuesta tiene que poder ir al documento y encontrarlo igual.',
  ].join('\n');
}

/** La misma orden, dicha en cada idioma. */
const ANSWER_IN: Record<Locale, string> = {
  es: 'Responde en español.',
  en: 'Write your answer in English.',
};

/**
 * La respuesta cuando no hay nada sobre lo que responder.
 *
 * No la escribe el modelo —no se le llama siquiera, porque preguntarle sin material es la
 * situación en la que inventaría— así que la escribimos nosotros, y por tanto hay que
 * escribirla en cada idioma.
 */
const NO_KNOWLEDGE: Record<Locale, string> = {
  es:
    'No tengo conocimiento indexado que responda a esa pregunta. ' +
    'Si la información debería estar disponible, comprueba que la fuente correspondiente ' +
    'esté conectada y sincronizada.',
  en:
    'I have no indexed knowledge that answers that question. ' +
    'If the information should be available, check that the corresponding source is ' +
    'connected and synchronised.',
};

export function noKnowledgeAnswerIn(locale: Locale): string {
  return NO_KNOWLEDGE[locale];
}

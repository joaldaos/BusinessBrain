/**
 * Los idiomas que BusinessBrain habla.
 *
 * ## Idioma de la INTERFAZ, no del conocimiento
 *
 * Esta lista dice en qué idioma se le habla a una persona: los botones, los mensajes, la
 * respuesta del chat. **No dice nada sobre los documentos de la empresa.** Una asesoría de
 * Girona puede tener el producto en catalán, contratos en castellano y facturas de proveedor
 * en inglés, y las tres cosas son independientes. Confundirlas llevaría a traducir el
 * contenido de las fuentes, que es exactamente lo que no se puede hacer: un contrato traducido
 * automáticamente ya no es el contrato.
 *
 * ## Por qué una lista en código y no un enum de base de datos
 *
 * Añadir francés tiene que ser añadir una entrada aquí y un fichero de traducciones, no una
 * migración de esquema. La columna guarda texto y esta lista es la que valida: el modelo de
 * datos no tiene por qué enterarse de que existe un idioma nuevo.
 *
 * ## Por qué el catálogo está aquí y no en la interfaz
 *
 * Porque la API también lo necesita: valida la preferencia que se guarda y decide en qué
 * idioma se le pide al modelo que responda. Que la interfaz tenga traducciones para un idioma
 * que la API no reconoce —o al revés— es la clase de desajuste que solo se nota cuando un
 * cliente elige ese idioma. Una prueba de la interfaz compara ambas listas y falla si se
 * separan.
 */

export const SUPPORTED_LOCALES = ['es', 'en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * El idioma cuando no hay nada mejor.
 *
 * Castellano porque es el idioma en el que está escrito el producto y el de los primeros
 * clientes. No es una decisión permanente: es el respaldo cuando ni la persona ha elegido ni
 * el navegador dice nada útil.
 */
export const DEFAULT_LOCALE: Locale = 'es';

/**
 * Los que vendrán.
 *
 * Están escritos porque la arquitectura se diseñó para ellos —añadir uno es una entrada en
 * `SUPPORTED_LOCALES` y un fichero de traducciones, sin tocar ni un componente— y porque
 * dejarlo por escrito evita que alguien "prepare" el terreno de una forma que no encaje.
 *
 * NO están soportados todavía, a propósito: una traducción a medias es peor que ninguna.
 */
export const PLANNED_LOCALES = ['fr', 'de', 'it', 'pt', 'ca'] as const;

export function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * Cómo se llama cada idioma EN SÍ MISMO.
 *
 * Se le da al modelo así —"responde en English", no "responde en inglés"— porque nombrar un
 * idioma en su propia lengua es la forma menos ambigua de pedirlo, y porque la instrucción
 * sigue siendo legible sea cual sea el idioma en el que esté escrito el resto del prompt.
 */
const ENDONYMS: Record<Locale, string> = {
  es: 'español',
  en: 'English',
};

export function localeEndonym(locale: Locale): string {
  return ENDONYMS[locale];
}

/**
 * Interpreta lo que dice el navegador.
 *
 * Llega como `es-ES`, `en-GB`, `ca-ES` o una lista entera de preferencias. Solo importa la
 * primera parte: alguien con `es-AR` quiere castellano, y no tener traducción argentina no es
 * motivo para enseñarle inglés.
 *
 * Se recorre la lista en orden y gana la primera que se hable. Un navegador configurado en
 * francés y con inglés como segunda opción debe recibir inglés, no el idioma por defecto.
 */
export function localeFromAcceptLanguage(header: string | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;

  const preferidos = header
    .split(',')
    .map((parte) => parte.split(';')[0].trim().toLowerCase())
    .filter((parte) => parte.length > 0);

  for (const preferido of preferidos) {
    const base = preferido.split('-')[0];
    if (isSupportedLocale(base)) return base;
  }

  return DEFAULT_LOCALE;
}

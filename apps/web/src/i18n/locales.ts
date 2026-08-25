/**
 * Los idiomas de la interfaz.
 *
 * ## Esta lista tiene que coincidir con la del backend
 *
 * La API valida la preferencia que se guarda y decide en qué idioma le pide al modelo que
 * responda. Si la interfaz ofreciera un idioma que la API no reconoce, elegirlo devolvería un
 * error incomprensible; y si la API aceptara uno sin traducciones, el producto se quedaría
 * medio en un idioma y medio en otro.
 *
 * No se comparte el fichero —son dos aplicaciones distintas y no hay un paquete común para
 * esto— así que lo que impide que se separen es una prueba: `locales.test.ts` importa la lista
 * del backend y falla si no cuadran.
 */

export const SUPPORTED_LOCALES = ['es', 'en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Castellano: es el idioma en el que está escrito el producto y el respaldo de todo lo demás. */
export const DEFAULT_LOCALE: Locale = 'es';

/**
 * Cómo se llama cada idioma en su propia lengua.
 *
 * En un selector de idioma se escribe siempre así. Alguien que tiene el producto en un idioma
 * que no entiende —porque lo cambió por error, o porque le llegó la cuenta ya configurada—
 * necesita reconocer el suyo para poder volver, y "Inglés" no le sirve de nada si la interfaz
 * está en inglés.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
};

export function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * Qué idioma quiere este navegador.
 *
 * `navigator.languages` llega como `['ca-ES', 'es-ES', 'en']`: la lista entera de preferencias
 * en orden. Se recorre y gana la primera que hablemos — un navegador en catalán con castellano
 * detrás debe recibir castellano, no inglés ni el idioma por defecto.
 *
 * Solo importa la primera parte del código: alguien con `es-AR` quiere castellano, y no tener
 * traducción argentina no es motivo para enseñarle otra cosa.
 */
export function localeFromBrowser(
  languages: readonly string[] = typeof navigator === 'undefined'
    ? []
    : (navigator.languages ?? [navigator.language]),
): Locale {
  for (const preferido of languages) {
    const base = preferido.toLowerCase().split('-')[0];
    if (isSupportedLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

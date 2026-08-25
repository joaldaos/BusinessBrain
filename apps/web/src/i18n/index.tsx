import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import { es } from './catalog/es';
import { en } from './catalog/en';
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  localeFromBrowser,
  type Locale,
} from './locales';
import type { Catalog, TranslationKey } from './catalog/es';

/**
 * El idioma de la interfaz.
 *
 * ## Ningún componente sabe qué idiomas existen
 *
 * Un componente pide una frase por su clave y recibe texto. No consulta el idioma, no elige
 * catálogo y no tiene condicionales por idioma. Eso es lo que permite que añadir francés sea
 * un fichero de traducciones y una entrada en la lista, **sin tocar ni una pantalla** — que es
 * exactamente lo que se pidió que quedara preparado.
 *
 * ## Qué pasa cuando falta una traducción
 *
 * Se cae al castellano, que es el idioma en el que está escrito el producto y el único
 * catálogo obligatoriamente completo. Un idioma nuevo puede entrar traducido a medias y la
 * pantalla seguirá siendo legible; lo que no puede pasar nunca es que aparezca la clave en
 * bruto delante de un cliente.
 *
 * Y si ni siquiera existe en castellano, se devuelve la clave: es un error de programación, y
 * verlo en pantalla durante el desarrollo es mejor que una cadena vacía que nadie nota.
 *
 * ## De dónde sale el idioma inicial
 *
 * De la preferencia de la persona si la ha guardado. Si no, del navegador. Alguien que entra
 * por primera vez desde un navegador en inglés no debería tener que buscar un selector para
 * poder leer la pantalla de registro.
 */

const CATALOGS: Record<Locale, Partial<Catalog>> = { es, en };

interface I18nState {
  locale: Locale;
  /** Traduce. `params` sustituye `{marcador}` por su valor. */
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  /** Cambia el idioma y, si hay sesión, lo guarda en la persona. */
  setLocale: (locale: Locale) => Promise<void>;
}

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({
  /**
   * El idioma guardado de la persona, si hay sesión.
   *
   * Llega desde fuera en vez de leerse aquí porque quien conoce la sesión es `AuthProvider`.
   * Cuando es `null` —nadie ha entrado todavía, o no ha elegido idioma— manda el navegador.
   */
  preferred,
  children,
}: {
  preferred: string | null | undefined;
  children: ReactNode;
}) {
  const [override, setOverride] = useState<Locale | null>(null);

  const locale = useMemo<Locale>(() => {
    // Lo que la persona acaba de elegir manda sobre todo lo demás: el cambio tiene que verse
    // en el acto, sin esperar a que la sesión se recargue.
    if (override) return override;
    if (isSupportedLocale(preferred)) return preferred;
    return localeFromBrowser();
  }, [override, preferred]);

  // El idioma del documento: lo usan los lectores de pantalla y el corrector del navegador.
  // Dejarlo fijo en castellano haría que una interfaz en inglés se leyera con acento español.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => {
      const plantilla = CATALOGS[locale][key] ?? es[key] ?? key;
      if (!params) return plantilla;

      return Object.entries(params).reduce(
        (texto, [nombre, valor]) =>
          texto.replaceAll(`{${nombre}}`, String(valor)),
        plantilla,
      );
    },
    [locale],
  );

  const setLocale = useCallback(async (next: Locale) => {
    setOverride(next);

    // Se guarda si hay sesión. Sin ella —en la pantalla de entrada— el cambio vale para esta
    // visita y no hay nadie a quien atribuirlo; forzar el guardado daría un 401 que la
    // persona no entendería y que además no significa nada.
    try {
      await api('/auth/me/language', {
        method: 'PATCH',
        withoutOrganization: true,
        body: { locale: next },
      });
    } catch {
      // El idioma ya cambió en pantalla. Que no se haya podido guardar es un problema de la
      // próxima visita, no de esta, y romper la interfaz por eso sería desproporcionado.
    }
  }, []);

  const value = useMemo<I18nState>(
    () => ({ locale, t, setLocale }),
    [locale, t, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n fuera de I18nProvider');
  return context;
}

/** Atajo para el caso normal: solo hace falta traducir. */
export function useT(): I18nState['t'] {
  return useI18n().t;
}

export { DEFAULT_LOCALE, type Locale };
export type { TranslationKey };

import {
  DEFAULT_LOCALE,
  PLANNED_LOCALES,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  localeEndonym,
  localeFromAcceptLanguage,
} from './locales';

describe('idiomas que habla BusinessBrain', () => {
  it('hoy son castellano e inglés', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(['es', 'en']);
  });

  it('los que vendrán están declarados pero NO soportados', () => {
    // Una traducción a medias es peor que ninguna: hasta que el catálogo esté completo, el
    // idioma no se ofrece.
    for (const planeado of PLANNED_LOCALES) {
      expect(isSupportedLocale(planeado)).toBe(false);
    }
  });

  it('rechaza cualquier cosa que no sea un idioma que hablamos', () => {
    for (const basura of [null, undefined, 42, 'es-ES', 'ESPAÑOL', '']) {
      expect(isSupportedLocale(basura)).toBe(false);
    }
  });

  it('cada idioma se nombra en su propia lengua', () => {
    // Es lo que se le dice al modelo: "responde en English" es menos ambiguo que "en inglés".
    expect(localeEndonym('es')).toBe('español');
    expect(localeEndonym('en')).toBe('English');
  });

  describe('lo que pide el navegador', () => {
    it('CRÍTICO: gana la primera preferencia que hablamos, no la primera de la lista', () => {
      // Un navegador en catalán con inglés detrás debe recibir inglés. Quedarse con la
      // primera y rendirse le daría el idioma por defecto sin motivo.
      expect(localeFromAcceptLanguage('ca-ES,ca;q=0.9,en;q=0.8')).toBe('en');
      expect(localeFromAcceptLanguage('fr-FR,es;q=0.7')).toBe('es');
    });

    it('la variante regional no importa', () => {
      expect(localeFromAcceptLanguage('es-AR')).toBe('es');
      expect(localeFromAcceptLanguage('EN-GB,en;q=0.9')).toBe('en');
    });

    it('sin cabecera, o con idiomas que no hablamos, cae al de por defecto', () => {
      expect(localeFromAcceptLanguage(undefined)).toBe(DEFAULT_LOCALE);
      expect(localeFromAcceptLanguage('')).toBe(DEFAULT_LOCALE);
      expect(localeFromAcceptLanguage('de,fr;q=0.8')).toBe(DEFAULT_LOCALE);
    });
  });
});

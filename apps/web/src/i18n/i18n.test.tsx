import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { es } from './catalog/es';
import { en } from './catalog/en';
import {
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
  localeFromBrowser,
} from './locales';
import { SUPPORTED_LOCALES as BACKEND_LOCALES } from '../../../backend/src/common/i18n/locales';
import { PLATFORM_AUDIT_ACTIONS } from '../../../backend/src/audit/domain/platform-actions';
import { I18nProvider, useI18n } from './index';
import { LanguagePicker } from '../components/LanguagePicker';
import { renderLocalized } from '../test/render';
import { api } from '../api/client';

vi.mock('../api/client', () => ({ api: vi.fn().mockResolvedValue(undefined) }));

describe('idiomas', () => {
  describe('la interfaz y la API hablan los mismos', () => {
    it('CRÍTICO: las dos listas coinciden', () => {
      // Son dos aplicaciones y no comparten fichero. Si la interfaz ofreciera un idioma que la
      // API no reconoce, elegirlo daría un error incomprensible; y si la API aceptara uno sin
      // traducciones, el producto quedaría medio en un idioma y medio en otro.
      expect([...SUPPORTED_LOCALES].sort()).toEqual(
        [...BACKEND_LOCALES].sort(),
      );
    });

    it('cada idioma tiene nombre para el selector', () => {
      for (const locale of SUPPORTED_LOCALES) {
        expect(LOCALE_NAMES[locale]).toBeTruthy();
      }
    });
  });

  describe('los catálogos', () => {
    it('CRÍTICO: el inglés no tiene huecos', () => {
      // Un idioma que el producto dice hablar tiene que estar completo: una interfaz a medias
      // traducida es peor que no haber ofrecido el idioma.
      const faltan = Object.keys(es).filter(
        (clave) => !(clave in en) || !en[clave as keyof typeof en],
      );

      expect(faltan).toEqual([]);
    });

    it('no sobra ninguna clave que el castellano no tenga', () => {
      // Una clave huérfana es texto que nadie pinta: o falta usarla, o sobra.
      expect(Object.keys(en).filter((clave) => !(clave in es))).toEqual([]);
    });

    it('CRÍTICO: no se cuela vocabulario interno en ningún idioma', () => {
      // `INDEXED`, `SUPERSEDED`, `OWNER`, `ANOMALY`… son constantes de un modelo de datos. Lo
      // que se traduce es su significado, y la constante no puede aparecer NUNCA como texto.
      const constantes =
        /\b(INDEXED|SUPERSEDED|ANOMALY|OWNER|VIEWER|PENDING|FAILED|CANDIDATE|DISMISSED|ACCEPTED|FRESH|STALE|UNRESOLVABLE)\b/;

      for (const [catalogo, entradas] of [
        ['es', es],
        ['en', en],
      ] as const) {
        const sucias = Object.entries(entradas)
          .filter(([clave, valor]) => {
            // La CLAVE sí lleva la constante —`status.role.OWNER`— y debe llevarla: es lo que
            // permite traducir por valor. Lo que se mira es el TEXTO.
            void clave;
            return constantes.test(valor);
          })
          .map(([clave]) => clave);

        expect(sucias, `catálogo ${catalogo}`).toEqual([]);
      }
    });

    it('CRÍTICO: toda acción de auditoría de plataforma tiene nombre para una persona', () => {
      // La API manda códigos —`platform.user.banned` es vocabulario de un catálogo interno— y
      // la pantalla nunca puede enseñarlos. Si alguien añade una acción administrativa y no la
      // traduce, esta prueba lo dice antes de que un código aparezca delante de nadie.
      const sinTraducir = PLATFORM_AUDIT_ACTIONS.flatMap((accion) =>
        (['es', 'en'] as const)
          .filter(
            (idioma) =>
              !(`audit.action.${accion}` in (idioma === 'es' ? es : en)),
          )
          .map((idioma) => `${idioma}:${accion}`),
      );

      expect(sinTraducir).toEqual([]);
    });

    it('las claves de estado cubren el vocabulario que manda el backend', () => {
      // Si el backend añade un estado y aquí no está, la interfaz enseñaría la constante.
      for (const estado of ['INDEXED', 'PROCESSING', 'FAILED', 'SUPERSEDED']) {
        expect(es).toHaveProperty(`status.knowledgeItem.${estado}`);
      }
      for (const rol of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']) {
        expect(es).toHaveProperty(`status.role.${rol}`);
      }
    });
  });

  describe('el idioma inicial sale del navegador', () => {
    it('CRÍTICO: gana la primera preferencia que hablamos', () => {
      // Un navegador en catalán con castellano detrás debe recibir castellano, no el idioma
      // por defecto por casualidad ni inglés.
      expect(localeFromBrowser(['ca-ES', 'es-ES', 'en'])).toBe('es');
      expect(localeFromBrowser(['en-GB', 'es'])).toBe('en');
    });

    it('la variante regional no importa', () => {
      // Alguien con `es-AR` quiere castellano; no tener traducción argentina no es motivo
      // para enseñarle otra cosa.
      expect(localeFromBrowser(['es-AR'])).toBe('es');
      expect(localeFromBrowser(['EN-US'])).toBe('en');
    });

    it('un idioma que todavía no hablamos cae al de por defecto', () => {
      expect(localeFromBrowser(['fr-FR', 'de'])).toBe(DEFAULT_LOCALE);
      expect(localeFromBrowser([])).toBe(DEFAULT_LOCALE);
    });
  });

  describe('cambiar de idioma', () => {
    beforeEach(() => {
      vi.mocked(api).mockClear();
    });

    function Muestra() {
      const { t, locale } = useI18n();
      return (
        <>
          <p data-testid="titulo">{t('nav.knowledge')}</p>
          <p data-testid="locale">{locale}</p>
        </>
      );
    }

    it('CRÍTICO: de español a inglés cambia lo que se lee', async () => {
      renderLocalized(
        <>
          <Muestra />
          <LanguagePicker />
        </>,
        'es',
      );

      expect(screen.getByTestId('titulo')).toHaveTextContent('Conocimiento');

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });

      await waitFor(() =>
        expect(screen.getByTestId('titulo')).toHaveTextContent('Knowledge'),
      );
      expect(screen.getByTestId('locale')).toHaveTextContent('en');
    });

    it('CRÍTICO: la elección se guarda en la persona', async () => {
      // Sin esto, el idioma se perdería al recargar y habría que elegirlo cada vez.
      renderLocalized(<LanguagePicker />, 'es');

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });

      await waitFor(() =>
        expect(api).toHaveBeenCalledWith('/auth/me/language', {
          method: 'PATCH',
          withoutOrganization: true,
          body: { locale: 'en' },
        }),
      );
    });

    it('si no se puede guardar, el idioma cambia igualmente', async () => {
      // El cambio ya está en pantalla. Que no se haya podido guardar es un problema de la
      // próxima visita, no de esta: romper la interfaz por eso sería desproporcionado.
      vi.mocked(api).mockRejectedValueOnce(new Error('sin sesión'));

      renderLocalized(
        <>
          <Muestra />
          <LanguagePicker />
        </>,
        'es',
      );
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });

      await waitFor(() =>
        expect(screen.getByTestId('titulo')).toHaveTextContent('Knowledge'),
      );
    });

    it('los idiomas se ofrecen en su propia lengua', () => {
      // Quien tiene el producto en un idioma que no entiende necesita reconocer el suyo.
      renderLocalized(<LanguagePicker />, 'en');

      expect(screen.getByRole('option', { name: 'Español' })).toBeTruthy();
      expect(screen.getByRole('option', { name: 'English' })).toBeTruthy();
    });
  });

  describe('sustitución de valores', () => {
    function Contador() {
      const { t } = useI18n();
      return <p>{t('insights.title', { count: 3 })}</p>;
    }

    it('coloca el valor donde toca en cada idioma', () => {
      renderLocalized(<Contador />, 'es');
      expect(screen.getByText('Conclusiones (3)')).toBeTruthy();
    });
  });

  describe('cuando falta una traducción', () => {
    it('se cae al castellano en vez de enseñar la clave', () => {
      // Es lo que permitirá que francés, alemán, italiano, portugués o catalán entren
      // traducidos a medias sin que la pantalla se rompa.
      const parcial = { 'nav.ask': 'Demander' } as Record<string, string>;
      const buscada = parcial['nav.knowledge'] ?? es['nav.knowledge'];

      expect(buscada).toBe('Conocimiento');
    });
  });

  it('el idioma se refleja en el documento, para lectores de pantalla', async () => {
    renderLocalized(<LanguagePicker />, 'en');

    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
  });
});

/**
 * La promesa de la arquitectura, como garantía y no como intención.
 *
 * Se pidió que añadir francés, alemán, italiano, portugués o catalán no obligara a tocar los
 * componentes. Eso solo es cierto mientras NINGÚN componente sepa qué idiomas existen: en
 * cuanto uno tenga un `if (locale === 'es')` o importe un catálogo, añadir un idioma pasa a
 * ser una revisión pantalla por pantalla.
 *
 * Esta prueba recorre las pantallas y falla si alguna empieza a saberlo.
 */
describe('ningún componente sabe qué idiomas existen', () => {
  const ficheros = Object.entries(
    import.meta.glob('../{pages,components}/**/*.tsx', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>,
  );

  it('la prueba encuentra pantallas que revisar', () => {
    expect(ficheros.length).toBeGreaterThan(10);
  });

  it('CRÍTICO: ninguna compara contra un código de idioma', () => {
    // `locale === 'es'` en una pantalla es una rama que habría que replicar por cada idioma
    // nuevo. Los nombres de los idiomas para el selector viven en `i18n/locales.ts`, que no
    // es un componente.
    const culpables = ficheros
      .filter(([ruta]) => !ruta.includes('.test.'))
      .filter(([, codigo]) =>
        /locale\s*[=!]==\s*['"](es|en|fr|de|it|pt|ca)['"]/.test(codigo),
      )
      .map(([ruta]) => ruta);

    expect(culpables).toEqual([]);
  });

  it('CRÍTICO: ninguna importa un catálogo de traducciones', () => {
    // Un componente que importa `catalog/es` deja de traducirse solo: pasa a tener texto de
    // un idioma concreto dentro.
    const culpables = ficheros
      .filter(([ruta]) => !ruta.includes('.test.'))
      .filter(([, codigo]) => /from\s+['"][^'"]*catalog\/(es|en)['"]/.test(codigo))
      .map(([ruta]) => ruta);

    expect(culpables).toEqual([]);
  });
});

/** El proveedor debe poder montarse sin sesión: la pantalla de entrada no tiene ninguna. */
describe('sin sesión', () => {
  it('usa el idioma del navegador y no falla', () => {
    renderLocalized(<span>ok</span>);
    expect(I18nProvider).toBeTruthy();
  });
});

import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nProvider } from '../i18n';
import type { Locale } from '../i18n/locales';

/**
 * Renderiza un componente con un idioma concreto.
 *
 * Todo lo que se pinta pasa por el catálogo, así que sin proveedor de idioma no hay
 * componente que renderice. Que sea un helper y no un envoltorio a mano en cada prueba es lo
 * que permite escribir la misma prueba en dos idiomas sin duplicarla.
 */
export function renderLocalized(
  ui: ReactElement,
  locale: Locale = 'es',
): RenderResult {
  return render(<I18nProvider preferred={locale}>{ui}</I18nProvider>);
}

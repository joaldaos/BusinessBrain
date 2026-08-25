import { useI18n } from '../i18n';
import { LOCALE_NAMES, SUPPORTED_LOCALES, type Locale } from '../i18n/locales';

/**
 * Elegir idioma.
 *
 * ## Cada idioma se escribe en su propia lengua
 *
 * "Español", "English" — nunca "Inglés". Alguien que tiene el producto en un idioma que no
 * entiende, porque lo cambió por error o porque le llegó la cuenta ya configurada, necesita
 * reconocer el suyo en la lista para poder volver. Traducir los nombres de los idiomas
 * convierte ese selector en un callejón sin salida.
 *
 * ## Por qué no sabe qué idiomas existen
 *
 * Recorre la lista y ya está. Añadir francés no toca este componente, igual que no toca
 * ninguna pantalla: esa es toda la promesa de la arquitectura de idiomas.
 */
export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <label
      className={
        compact
          ? 'inline-flex items-center gap-2'
          : 'flex items-center justify-center gap-2'
      }
    >
      <span className="text-xs text-gray-500">{t('settings.language')}</span>
      <select
        aria-label={t('settings.language')}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
        value={locale}
        onChange={(event) => void setLocale(event.target.value as Locale)}
      >
        {SUPPORTED_LOCALES.map((candidato) => (
          <option key={candidato} value={candidato}>
            {LOCALE_NAMES[candidato]}
          </option>
        ))}
      </select>
    </label>
  );
}

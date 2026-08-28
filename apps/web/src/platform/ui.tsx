import { useI18n, useT } from '../i18n';
import type { ReactNode } from 'react';

/**
 * El vocabulario visual del panel de operación.
 *
 * ## Por qué no reutiliza `components/ui.tsx`
 *
 * Aquellas piezas se escribieron para el producto de cliente con una nota explícita: "esto es
 * una herramienta de trabajo interna y la prioridad es que el flujo funcione, no que sea
 * bonito". Aquí la prioridad es otra. Este panel es donde alguien decide si abre los documentos
 * de una empresa, y una pantalla que no distingue de un vistazo lo grave de lo trivial empuja
 * a pulsar sin leer.
 *
 * Lo que se comparte es lo que debe compartirse: el sistema de traducción, el cliente HTTP y el
 * diálogo de reautenticación. Lo que no, es la capa de pintura.
 *
 * ## Las reglas
 *
 * Un solo acento y el resto en grises. El color se reserva para el ESTADO —ámbar pide
 * atención, rojo bloquea, verde está vigente— así que cuando aparece, significa algo. Un panel
 * con seis colores decorativos no puede después usar el color para avisar.
 *
 * Cifras en `tabular-nums` para que las columnas de una tabla se lean como una columna y no
 * como una lista de números sueltos.
 */

// ── Encabezados ──────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-white">
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            {title && (
              <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
            )}
            {description && (
              <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-muted">
                {description}
              </p>
            )}
          </div>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

// ── Números ──────────────────────────────────────────────────────────────────

/**
 * Una cifra con su rótulo.
 *
 * Sin iconos ni flechas de tendencia: no hay serie histórica detrás, y una flecha inventada es
 * peor que ningún indicador porque se lee como información.
 */
export function Metric({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'neutral' | 'warn';
}) {
  const { locale } = useI18n();
  const shown =
    typeof value === 'number' ? value.toLocaleString(locale) : value;

  return (
    <div className="rounded-lg border border-line bg-white px-5 py-4">
      <p className="text-[12px] uppercase tracking-[0.06em] text-muted">
        {label}
      </p>
      <p
        className={`mt-1.5 text-[26px] font-semibold tabular-nums tracking-[-0.02em] ${
          tone === 'warn' && value !== 0 ? 'text-amber-700' : 'text-ink'
        }`}
      >
        {shown}
      </p>
      {hint && <p className="mt-1 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

// ── Estado ───────────────────────────────────────────────────────────────────

export type Tone = 'neutral' | 'active' | 'attention' | 'blocked' | 'quiet';

export function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  const styles: Record<Tone, string> = {
    neutral: 'bg-gray-100 text-gray-700',
    active: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
    attention: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
    blocked: 'bg-red-50 text-red-800 ring-1 ring-red-200',
    quiet: 'bg-transparent text-muted ring-1 ring-line',
  };

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

// ── Tablas ───────────────────────────────────────────────────────────────────

export function DataTable({
  head,
  children,
}: {
  head: ReactNode[];
  children: ReactNode;
}) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[13.5px]">
        <thead>
          <tr className="border-b border-line">
            {head.map((cell, index) => (
              <th
                key={index}
                scope="col"
                className="px-5 py-2.5 text-left text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Row({
  children,
  onOpen,
}: {
  children: ReactNode;
  onOpen?: () => void;
}) {
  return (
    <tr
      onClick={onOpen}
      className={onOpen ? 'cursor-pointer transition hover:bg-gray-50' : ''}
    >
      {children}
    </tr>
  );
}

export function Cell({
  children,
  numeric,
  muted,
}: {
  children: ReactNode;
  numeric?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`px-5 py-3 align-middle ${numeric ? 'tabular-nums' : ''} ${
        muted ? 'text-muted' : ''
      }`}
    >
      {children}
    </td>
  );
}

// ── Los cuatro estados de cualquier pantalla ─────────────────────────────────

/**
 * Carga, error, vacío o datos. Los cuatro, siempre.
 *
 * Se resuelven en un solo sitio porque, repartidos por cada pantalla, el que se olvida es
 * siempre el mismo: el vacío. Y una tabla vacía sin explicación se lee como una avería.
 *
 * El error NUNCA muestra el mensaje del backend. Ese texto está en un idioma fijo, escrito
 * para quien lee un registro, y aquí solo consigue asustar. Lo que se ofrece es lo único útil:
 * volver a intentarlo.
 */
export function DataState({
  loading,
  error,
  empty,
  emptyMessage,
  onRetry,
  children,
}: {
  loading: boolean;
  error: unknown;
  empty?: boolean;
  emptyMessage?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const t = useT();

  if (loading) {
    return (
      <p
        role="status"
        aria-live="polite"
        className="py-10 text-center text-[13px] text-muted"
      >
        {t('platform.state.loading')}
      </p>
    );
  }

  if (error) {
    return (
      <div role="alert" className="py-10 text-center">
        <p className="text-[13.5px] text-ink">{t('platform.state.error')}</p>
        <p className="mx-auto mt-1 max-w-md text-[12.5px] text-muted">
          {t('platform.state.errorHint')}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded border border-line bg-white px-3 py-1.5 text-[13px] font-medium transition hover:border-gray-400"
          >
            {t('platform.state.retry')}
          </button>
        )}
      </div>
    );
  }

  if (empty) {
    return (
      <p className="py-10 text-center text-[13px] text-muted">
        {emptyMessage ?? t('platform.state.empty')}
      </p>
    );
  }

  return <>{children}</>;
}

// ── Botones ──────────────────────────────────────────────────────────────────

export function ActionButton({
  children,
  onClick,
  variant = 'default',
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  /** `grave` se reserva para lo que afecta a la cuenta de otra persona o a sus datos. */
  variant?: 'default' | 'primary' | 'grave';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const styles = {
    default:
      'border-line bg-white text-ink hover:border-gray-400 disabled:hover:border-line',
    primary:
      'border-transparent bg-[#14161a] text-white hover:bg-[#2a2e35] disabled:hover:bg-[#14161a]',
    grave:
      'border-red-200 bg-white text-red-700 hover:border-red-400 disabled:hover:border-red-200',
  }[variant];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded border px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${styles}`}
    >
      {children}
    </button>
  );
}

// ── Fechas ───────────────────────────────────────────────────────────────────

/**
 * Fechas en el formato del idioma activo.
 *
 * `04/09/2026` es el 4 de septiembre para una PYME española y el 9 de abril para una inglesa.
 * En una traza de auditoría esa ambigüedad no es un detalle.
 */
export function useDateFormat() {
  const { locale } = useI18n();

  return {
    dateTime: (value: string | null | undefined) =>
      value
        ? new Date(value).toLocaleString(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })
        : '—',
    date: (value: string | null | undefined) =>
      value ? new Date(value).toLocaleDateString(locale, { dateStyle: 'medium' }) : '—',
  };
}

/**
 * "Caduca en 3 horas" en vez de una marca de tiempo.
 *
 * Para decidir si hace falta pedir otra concesión, lo que importa es cuánto queda, no en qué
 * instante exacto termina. La fecha completa se enseña al lado, para quien la necesite.
 */
export function useRelativeDeadline() {
  const { locale } = useI18n();
  const t = useT();

  return (value: string): string => {
    const restantes = new Date(value).getTime() - Date.now();
    if (restantes <= 0) return t('platform.grant.expiredAlready');

    const formato = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const horas = Math.round(restantes / 3_600_000);

    return horas >= 24
      ? formato.format(Math.round(horas / 24), 'day')
      : formato.format(Math.max(horas, 1), 'hour');
  };
}

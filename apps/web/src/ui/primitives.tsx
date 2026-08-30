import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Las piezas de las que está hecho BusinessBrain, cliente y plataforma.
 *
 * ## Por qué esto existe ahora y no antes
 *
 * Había DOS sistemas: uno en `components/ui.tsx`, escrito con una nota que decía "la
 * prioridad es que el flujo funcione, no que sea bonito", y otro en `platform/ui.tsx`,
 * bastante mejor, que cubría solo las pantallas más nuevas. Entre los dos sumaban dieciséis
 * tamaños de texto y cinco grises distintos para lo mismo.
 *
 * Este fichero es el segundo promovido a común. No es un rediseño desde cero: es el sistema
 * que ya funcionaba, ampliado y puesto donde lo alcanza todo el producto.
 *
 * ## La regla que ordena los botones
 *
 * La acción principal es CASI NEGRA, no azul. Antes todo botón era `bg-blue-700`, así que
 * "Crear" pesaba lo mismo que "Conectar Google Drive" y lo mismo que "Guardar tope": con todo
 * gritando, nada destaca. Ahora hay una sola acción oscura por bloque, el resto son
 * contornos, y el rojo se reserva para lo que no se puede deshacer.
 */

// ── Botones ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-ink text-white border-transparent hover:bg-ink-soft disabled:hover:bg-ink',
  secondary:
    'bg-surface text-ink border-line hover:border-line-strong hover:bg-sunken disabled:hover:border-line disabled:hover:bg-surface',
  ghost:
    'bg-transparent text-muted border-transparent hover:text-ink hover:bg-sunken',
  danger:
    'bg-surface text-danger border-danger/25 hover:border-danger/60 hover:bg-danger-soft disabled:hover:border-danger/25 disabled:hover:bg-surface',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}) {
  const dimensions =
    size === 'sm' ? 'px-2.5 py-1 text-[0.8125rem]' : 'px-3.5 py-2 t-small';

  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${dimensions} ${BUTTON_STYLES[variant]} ${className}`}
    />
  );
}

// ── Superficies ──────────────────────────────────────────────────────────────

/**
 * Una sección de contenido.
 *
 * La cabecera solo dibuja su separador cuando hay algo debajo que separar. Antes toda tarjeta
 * llevaba un borde bajo el título aunque el contenido fuera una línea, y una pantalla con
 * cinco tarjetas así se llena de rayas horizontales que no significan nada.
 */
export function Section({
  title,
  description,
  actions,
  children,
  flush,
  tone = 'default',
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  /** Sin relleno interior: para tablas, que traen el suyo. */
  flush?: boolean;
  /** `danger` para lo que no se puede deshacer. */
  tone?: 'default' | 'danger';
}) {
  const border = tone === 'danger' ? 'border-danger/25' : 'border-line';

  return (
    <section
      className={`overflow-hidden rounded-lg border bg-surface shadow-card ${border}`}
    >
      {(title || actions) && (
        <header
          className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4 ${
            children ? 'pb-4' : 'pb-4'
          }`}
        >
          <div className="min-w-0">
            {title && (
              <h2
                className={`t-title ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}
              >
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 max-w-2xl t-small text-muted">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
        </header>
      )}
      {children && (
        <div className={flush ? '' : `px-5 pb-5 ${title ? 'pt-0' : 'pt-5'}`}>
          {children}
        </div>
      )}
    </section>
  );
}

/** Encabezado de pantalla. Siempre con `<h1>`: cada pantalla tiene un título de verdad. */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="mb-7">
      {back && <div className="mb-3">{back}</div>}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-2xl">
          <h1 className="t-display text-ink">{title}</h1>
          {description && (
            <p className="mt-2 t-lead text-muted">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}

// ── Cifras ───────────────────────────────────────────────────────────────────

/**
 * Una métrica.
 *
 * Cuando vale cero se apaga y explica qué aparecerá aquí. Cuatro cajas con un `0` enorme
 * parecen cuatro errores; un cero apagado con una frase debajo parece un producto esperando
 * a que le den de comer, que es exactamente lo que está pasando.
 */
export function Metric({
  label,
  value,
  hint,
  emptyHint,
  href,
}: {
  label: string;
  value: number | string;
  hint?: string;
  /** Qué decir cuando el valor es cero. */
  emptyHint?: string;
  href?: string;
}) {
  const vacia = value === 0 || value === '0';
  const Contenedor = href ? 'a' : 'div';

  return (
    <Contenedor
      {...(href ? { href } : {})}
      className={`block rounded-lg border border-line bg-surface px-5 py-4 shadow-card ${
        href ? 'transition-colors hover:border-line-strong' : ''
      }`}
    >
      <p className="t-micro text-muted">{label}</p>
      <p
        className={`mt-2 t-figure text-[1.625rem] font-semibold leading-none ${
          vacia ? 'text-faint' : 'text-ink'
        }`}
      >
        {value}
      </p>
      {(vacia ? emptyHint : hint) && (
        <p className="mt-2 t-small text-muted">{vacia ? emptyHint : hint}</p>
      )}
    </Contenedor>
  );
}

// ── Estado ───────────────────────────────────────────────────────────────────

export type Tone = 'neutral' | 'positive' | 'attention' | 'danger' | 'quiet';

const PILL_STYLES: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-soft ring-line',
  positive: 'bg-positive-soft text-positive ring-positive/20',
  attention: 'bg-attention-soft text-attention ring-attention/20',
  danger: 'bg-danger-soft text-danger ring-danger/20',
  quiet: 'bg-transparent text-muted ring-line',
};

export function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ring-1 ring-inset ${PILL_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}

// ── Campos ───────────────────────────────────────────────────────────────────

/**
 * El aspecto de todo lo que se rellena. Una sola cadena para input, select y textarea: tres
 * definiciones parecidas acaban divergiendo en el borde de foco, que es justo lo que se nota.
 */
export const fieldClass =
  'w-full rounded-md border border-line bg-surface px-3 py-2 t-body text-ink outline-none transition-colors placeholder:text-faint hover:border-line-strong focus:border-accent disabled:bg-sunken disabled:text-muted';

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block t-small font-medium text-ink">{label}</span>
      {children}
      {hint && !error && (
        <span className="mt-1.5 block t-small text-muted">{hint}</span>
      )}
      {error && (
        <span className="mt-1.5 block t-small text-danger">{error}</span>
      )}
    </label>
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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse">
        <thead>
          <tr className="border-b border-line">
            {head.map((cell, index) => (
              <th
                key={index}
                scope="col"
                className="px-5 py-2.5 text-left t-micro text-muted"
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
  label,
}: {
  children: ReactNode;
  onOpen?: () => void;
  /** Qué se abre. Sin esto, una fila pulsable es invisible para el teclado. */
  label?: string;
}) {
  if (!onOpen) return <tr>{children}</tr>;

  return (
    <tr
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      role="link"
      aria-label={label}
      className="cursor-pointer transition-colors hover:bg-sunken focus-visible:bg-sunken"
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
      className={`px-5 py-3 align-middle t-body ${numeric ? 't-figure' : ''} ${
        muted ? 'text-muted' : 'text-ink-soft'
      }`}
    >
      {children}
    </td>
  );
}

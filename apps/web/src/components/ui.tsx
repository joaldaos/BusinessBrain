import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type FormEvent,
  type ReactNode,
} from 'react';
import { ApiError } from '../api/client';

/**
 * Piezas de interfaz compartidas.
 *
 * Deliberadamente sobrias: esto es una herramienta de trabajo interna, y la prioridad de esta
 * fase es que el flujo completo funcione, no que sea bonito.
 */

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const styles = {
    primary: 'bg-blue-700 text-white hover:bg-blue-800',
    secondary: 'bg-white text-gray-800 border border-gray-300 hover:bg-gray-50',
    danger: 'bg-white text-red-700 border border-red-300 hover:bg-red-50',
  }[variant];

  return (
    <button
      {...props}
      className={`rounded px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Card({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-700">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-600';

/**
 * Mensaje de error de la API.
 *
 * Se muestra LITERAL: el backend explica por qué deniega —qué colecciones faltan, por qué un
 * escalado exige curación propia— y reescribirlo aquí perdería justo la parte útil.
 */
export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;

  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);

  return (
    <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-gray-500">{children}</p>;
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const styles = {
    neutral: 'bg-gray-100 text-gray-700',
    good: 'bg-green-100 text-green-800',
    warn: 'bg-amber-100 text-amber-800',
    bad: 'bg-red-100 text-red-800',
  }[tone];

  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${styles}`}>
      {children}
    </span>
  );
}

export function Table({
  head,
  children,
}: {
  head: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs uppercase text-gray-500">
            {head.map((cell) => (
              <th key={cell} className="px-2 py-2 font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Carga de datos con estado explícito. Un error de la API nunca se traga en silencio. */
export function useResource<T>(
  load: () => Promise<T>,
  deps: unknown[] = [],
): {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    load()
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload: () => setNonce((n) => n + 1) };
}

/** Formulario con un solo envío en vuelo y su error a la vista. */
export function useAction(): {
  error: unknown;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  onSubmit: (action: () => Promise<unknown>) => (e: FormEvent) => void;
} {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(caught);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    error,
    busy,
    run,
    onSubmit: (action) => (event: FormEvent) => {
      event.preventDefault();
      void run(action);
    },
  };
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

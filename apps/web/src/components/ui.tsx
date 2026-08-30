import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useI18n } from '../i18n';
import { Section, StatusPill, type Tone } from '../ui';

/**
 * Lo que usan las pantallas de cliente.
 *
 * ## Este fichero ya no define aspecto: lo reexporta
 *
 * Durante seis fases su cabecera decía que la prioridad era que el flujo funcionara, no que
 * fuera bonito. Era cierto entonces. Mientras tanto, el panel de plataforma desarrolló un
 * sistema visual mejor que cubría solo las pantallas más nuevas, y el producto acabó con dos
 * escalas tipográficas, cinco grises para lo mismo y dos radios de borde.
 *
 * Ahora el sistema es `src/ui` y esto es la puerta por la que entran las diez pantallas de
 * cliente sin reescribirlas de golpe. Lo que queda escrito aquí es lo que NO es aspecto:
 * cargar datos, enviar un formulario y formatear fechas.
 */

export {
  Button,
  Section,
  PageHeader,
  Metric,
  StatusPill,
  Field,
  fieldClass,
  fieldClass as inputClass,
  DataTable,
  Row,
  Cell,
  DataState,
  EmptyState,
  ErrorNote,
  Skeleton,
  usePageTitle,
} from '../ui';

/**
 * Alias de compatibilidad: las pantallas de cliente llaman `Card` a lo que el sistema llama
 * `Section`. Se mantiene el nombre para no tocar diez ficheros por una palabra.
 */
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
    <Section title={title} actions={actions}>
      {children}
    </Section>
  );
}

/** Vacío de una línea, dentro de una tarjeta que ya explica de qué va. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center t-small text-muted">{children}</p>;
}

/**
 * Alias del distintivo de estado.
 *
 * Los tonos antiguos (`good`/`warn`/`bad`) se traducen a los del sistema. Renombrarlos en las
 * diez pantallas habría sido ruido en el diff sin ganar nada: el nombre viejo describe lo
 * mismo.
 */
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const equivalencia: Record<string, Tone> = {
    neutral: 'neutral',
    good: 'positive',
    warn: 'attention',
    bad: 'danger',
  };

  return <StatusPill tone={equivalencia[tone]}>{children}</StatusPill>;
}

/** Tabla sencilla de las pantallas de cliente. Misma retícula que la del sistema. */
export function Table({
  head,
  children,
}: {
  head: string[];
  children: ReactNode;
}) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            {head.map((cell) => (
              <th key={cell} scope="col" className="px-5 py-2.5 t-fine text-muted">
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

/**
 * Fechas en el formato del idioma activo.
 *
 * ## Por qué la fecha va completa
 *
 * Antes se usaba `dateStyle: 'short'`, que en castellano produce `30/8/26`. Un año a dos
 * cifras y un mes sin ceros parecen una nota a mano, no un producto — y en una traza de
 * auditoría la ambigüedad importa: `04/09/2026` es el 4 de septiembre para una PYME española
 * y el 9 de abril para una inglesa.
 *
 * Con `medium` el mes va escrito (`30 ago 2026`) y no hay forma de leerlo mal en ningún
 * idioma.
 */
export function formatDateIn(
  value: string | null | undefined,
  locale: string,
): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function useFormatDate(): (value: string | null | undefined) => string {
  const { locale } = useI18n();
  return useCallback(
    (value: string | null | undefined) => formatDateIn(value, locale),
    [locale],
  );
}

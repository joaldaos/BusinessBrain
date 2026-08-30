import type { ReactNode } from 'react';
import { ApiError } from '../api/client';
import { useT } from '../i18n';
import { Button } from './primitives';

/**
 * Los cuatro estados que tiene cualquier pantalla: cargando, error, vacío y con datos.
 *
 * ## Por qué viven aquí y no en cada pantalla
 *
 * Repartidos, el que siempre se olvida es el mismo: el vacío. Y una tabla vacía sin
 * explicación se lee como una avería — que es justo lo contrario de lo que está pasando.
 *
 * ## El error nunca enseña el mensaje del backend
 *
 * Ese texto está en un idioma fijo, escrito para quien lee un registro de servidor. Aquí se
 * traduce la CATEGORÍA —no tienes permiso, no se ha encontrado, no se ha podido cargar— y se
 * ofrece lo único útil: volver a intentarlo. La única excepción es 403, donde el motivo
 * importa: quien no puede hacer algo necesita saber que es un permiso y no una avería.
 *
 * Distinto es cuando el servidor RECHAZA algo concreto —un código mal escrito, un correo ya
 * usado— y dice por qué. Eso no es prosa de servidor: es la respuesta a lo que la persona
 * acaba de hacer, y se enseña tal cual. Ver `EL_SERVIDOR_EXPLICA`.
 */

// ── Carga ────────────────────────────────────────────────────────────────────

/**
 * Silueta del contenido que viene.
 *
 * Mejor que un "Cargando…": la pantalla no salta cuando llegan los datos, y quien mira ya ve
 * la forma de lo que va a leer.
 */
export function Skeleton({
  lines = 3,
  className = '',
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div
      className={`space-y-2.5 ${className}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Cargando</span>
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className="h-3 rounded bg-line"
          style={{
            width: `${[92, 78, 85, 64, 88][index % 5]}%`,
            animation: 'bb-pulse 1.6s ease-in-out infinite',
            animationDelay: `${index * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}

// ── Vacío ────────────────────────────────────────────────────────────────────

/**
 * Un estado vacío que no parece un error.
 *
 * Dice qué es esto, por qué está vacío y qué hacer — en tres frases como mucho. Un estado
 * vacío largo se lee peor que uno corto: quien llega aquí quiere saber qué pulsar.
 */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md px-6 py-10 text-center">
      <p className="t-body font-medium text-ink">{title}</p>
      {children && (
        <p className="mx-auto mt-1.5 t-small text-muted">{children}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

// ── Error ────────────────────────────────────────────────────────────────────

type ErrorKind = 'forbidden' | 'missing' | 'unknown';

function clasificar(error: unknown): ErrorKind {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'forbidden';
    if (error.status === 404) return 'missing';
  }
  return 'unknown';
}

/**
 * Estados en los que el servidor NO está fallando: está rechazando algo concreto y diciendo
 * por qué.
 *
 * "El código no es correcto", "esa dirección ya tiene cuenta", "la contraseña es demasiado
 * corta". Son frases escritas para la persona que está delante y son la ÚNICA información que
 * le permite arreglarlo. Sustituirlas por "no se ha podido cargar esto" deja a alguien
 * mirando un formulario sin saber qué cambiar — y eso fue exactamente lo que pasó al empezar
 * la Fase 8: la pantalla del segundo factor decía "no hemos podido cargar esto" cuando lo que
 * ocurría es que los seis dígitos estaban mal.
 *
 * Para todo lo demás —403, 404, 500, la red caída— el texto del servidor está escrito para
 * quien lee un registro, no sirve de nada y puede filtrar detalles internos. Ahí manda el
 * catálogo.
 */
const EL_SERVIDOR_EXPLICA = new Set([400, 401, 409, 422, 429]);

/**
 * Un error, dicho para una persona.
 *
 * Se usa dentro de un formulario, donde el error pertenece a lo que se acaba de intentar.
 * Para una pantalla entera que no carga, `DataState`.
 */
export function ErrorNote({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;

  const explicado =
    error instanceof ApiError &&
    EL_SERVIDOR_EXPLICA.has(error.status) &&
    error.message.trim().length > 0 &&
    // `Error 400` es el relleno de `readError` cuando no había cuerpo: no explica nada.
    !/^Error \d{3}$/.test(error.message);

  const clave = {
    forbidden: 'state.error.forbidden',
    missing: 'state.error.missing',
    unknown: 'state.error.unknown',
  }[clasificar(error)] as Parameters<typeof t>[0];

  return (
    <p
      role="alert"
      className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 t-small text-danger"
    >
      {explicado ? (error as ApiError).message : t(clave)}
    </p>
  );
}

/**
 * Los cuatro estados, resueltos de una vez.
 *
 * Quien la usa declara qué significa "vacío" para su pantalla; lo demás sale de aquí igual en
 * todo el producto.
 */
export function DataState({
  loading,
  error,
  empty,
  emptyMessage,
  emptyState,
  skeleton,
  onRetry,
  children,
}: {
  loading: boolean;
  error: unknown;
  empty?: boolean;
  /** Atajo para el caso normal: una frase. Para algo más rico, `emptyState`. */
  emptyMessage?: string;
  emptyState?: ReactNode;
  /** Cuántas líneas dibuja la silueta. */
  skeleton?: number;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const t = useT();

  if (loading) return <Skeleton lines={skeleton ?? 3} className="py-2" />;

  if (error) {
    const tipo = clasificar(error);

    return (
      <div role="alert" className="px-6 py-9 text-center">
        <p className="t-body font-medium text-ink">
          {t(
            tipo === 'forbidden'
              ? 'state.error.forbidden'
              : tipo === 'missing'
                ? 'state.error.missing'
                : 'state.error.unknown',
          )}
        </p>
        {tipo === 'unknown' && (
          <p className="mx-auto mt-1.5 max-w-sm t-small text-muted">
            {t('state.error.unknownHint')}
          </p>
        )}
        {onRetry && tipo === 'unknown' && (
          <div className="mt-4 flex justify-center">
            <Button onClick={onRetry}>{t('state.retry')}</Button>
          </div>
        )}
      </div>
    );
  }

  if (empty) {
    return (
      <>
        {emptyState ?? (
          <EmptyState title={emptyMessage ?? t('state.empty')} />
        )}
      </>
    );
  }

  return <>{children}</>;
}

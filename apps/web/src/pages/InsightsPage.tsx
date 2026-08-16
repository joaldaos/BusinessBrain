import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Insight } from '../api/types';
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  formatDate,
  useResource,
} from '../components/ui';

/**
 * Comprensión viva.
 *
 * Cada conclusión llega con su confianza, su frescura y su curación. La interfaz **no puede
 * ocultar ninguna de las tres**: un `Insight` cuya evidencia cambió no debe verse igual que
 * uno intacto (§3.4, "la frescura se entrega, no se oculta"), y una validación heredada no
 * debe verse igual que una emitida sobre esta versión (7.1).
 */
export function InsightsPage() {
  const insights = useResource(() => api<Insight[]>('/insights?limit=50'));

  return (
    <Card title={`Conclusiones (${insights.data?.length ?? 0})`}>
      <ErrorNote error={insights.error} />
      {insights.loading && <Empty>Cargando…</Empty>}
      {!insights.loading && (insights.data?.length ?? 0) === 0 && (
        <Empty>
          No hay conclusiones dentro de tu alcance. Puede que no haya análisis
          todavía, o que no tengas acceso a las colecciones que las sostienen.
        </Empty>
      )}

      <ul className="space-y-3">
        {insights.data?.map((insight) => (
          <li
            key={insight.id}
            className="rounded border border-gray-200 p-3"
          >
            <Link
              to={`/insights/${insight.id}`}
              className="text-sm font-medium text-blue-700 underline"
            >
              {insight.summary}
            </Link>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
              <Badge>{insight.type}</Badge>
              <span>confianza {insight.confidence.toFixed(2)}</span>
              <FreshnessBadge insight={insight} />
              <CurationBadge insight={insight} />
              <span className="text-gray-400">
                {formatDate(insight.createdAt)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function FreshnessBadge({ insight }: { insight: Insight }) {
  if (insight.freshness === 'FRESH') {
    return <Badge tone="good">evidencia intacta</Badge>;
  }
  return (
    <Badge tone={insight.freshness === 'STALE' ? 'warn' : 'bad'}>
      {insight.freshness === 'STALE'
        ? 'su evidencia cambió'
        : 'evidencia irresoluble'}
    </Badge>
  );
}

/**
 * Cómo se presenta la curación.
 *
 * Una validación HEREDADA se emitió sobre una versión anterior de la misma creencia. Mostrarla
 * como si fuera de esta afirmaría que alguien aprobó algo que no vio.
 */
export function CurationBadge({ insight }: { insight: Insight }) {
  const { curation } = insight;
  if (!curation) return null;

  if (curation.disputed) {
    return <Badge tone="bad">validación en disputa</Badge>;
  }
  if (curation.origin === 'INHERITED') {
    return <Badge tone="warn">validado en una versión anterior</Badge>;
  }
  return <Badge tone="good">validado por una persona</Badge>;
}

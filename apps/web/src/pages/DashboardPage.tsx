import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Automation, Insight, KnowledgeItem, Report } from '../api/types';
import { Badge, Card, Empty, ErrorNote, formatDate, useResource } from '../components/ui';

/**
 * Panel: en qué estado está la comprensión de la empresa ahora mismo.
 *
 * Cada número sale del mismo endpoint que su pantalla, no de un contador aparte: así lo que
 * se enseña aquí no puede divergir de lo que se ve al entrar.
 */
export function DashboardPage() {
  const insights = useResource(() =>
    api<Insight[]>('/insights?limit=5'),
  );
  const items = useResource(() => api<KnowledgeItem[]>('/knowledge-items'));
  const automations = useResource(() => api<Automation[]>('/automations'));
  const reports = useResource(() => api<Report[]>('/reports'));

  const disputed =
    insights.data?.filter((insight) => insight.curation?.disputed) ?? [];
  const stale =
    insights.data?.filter((insight) => insight.freshness !== 'FRESH') ?? [];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Documentos" value={items.data?.length} to="/conocimiento" />
        <Metric label="Conclusiones" value={insights.data?.length} to="/insights" />
        <Metric
          label="Automatizaciones"
          value={automations.data?.length}
          to="/automatizaciones"
        />
        <Metric label="Informes" value={reports.data?.length} to="/informes" />
      </div>

      <ErrorNote error={insights.error ?? items.error} />

      {(disputed.length > 0 || stale.length > 0) && (
        <Card title="Requiere tu atención">
          <ul className="space-y-2 text-sm">
            {disputed.map((insight) => (
              <li key={`d-${insight.id}`}>
                <Link className="text-blue-700 underline" to={`/insights/${insight.id}`}>
                  {insight.summary}
                </Link>{' '}
                <Badge tone="bad">validación en disputa</Badge>
                <p className="text-xs text-gray-500">
                  Alguien validó una versión anterior y la evidencia nueva la
                  contradice.
                </p>
              </li>
            ))}
            {stale.map((insight) => (
              <li key={`s-${insight.id}`}>
                <Link className="text-blue-700 underline" to={`/insights/${insight.id}`}>
                  {insight.summary}
                </Link>{' '}
                <Badge tone="warn">{insight.freshness}</Badge>
                <p className="text-xs text-gray-500">
                  {insight.freshnessRationale}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Lo último que hemos comprendido">
        {insights.loading && <Empty>Cargando…</Empty>}
        {!insights.loading && (insights.data?.length ?? 0) === 0 && (
          <Empty>
            Todavía no hay conclusiones. Sube conocimiento y lanza un análisis.
          </Empty>
        )}
        <ul className="space-y-3">
          {insights.data?.map((insight) => (
            <li key={insight.id} className="border-b border-gray-100 pb-3 last:border-0">
              <Link
                to={`/insights/${insight.id}`}
                className="text-sm font-medium text-blue-700 underline"
              >
                {insight.summary}
              </Link>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <Badge>{insight.type}</Badge>
                <span>confianza {insight.confidence.toFixed(2)}</span>
                <span>· {formatDate(insight.createdAt)}</span>
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function Metric({
  label,
  value,
  to,
}: {
  label: string;
  value: number | undefined;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="rounded-lg border border-gray-200 bg-white p-4 hover:border-blue-300"
    >
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value ?? '—'}</p>
    </Link>
  );
}

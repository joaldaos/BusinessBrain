import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Insight } from '../api/types';
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  PageHeader,
  useFormatDate,
  usePageTitle,
  useResource,
} from '../components/ui';
import { useT } from '../i18n';
import { useLabels } from '../i18n/labels';

/**
 * Comprensión viva.
 *
 * Cada conclusión llega con su confianza, su frescura y su curación. La interfaz **no puede
 * ocultar ninguna de las tres**: un `Insight` cuya evidencia cambió no debe verse igual que
 * uno intacto (§3.4, "la frescura se entrega, no se oculta"), y una validación heredada no
 * debe verse igual que una emitida sobre esta versión (7.1).
 *
 * El RESUMEN de cada conclusión se muestra tal cual: lo escribió el análisis a partir de los
 * documentos de la empresa y traducirlo sería reescribir lo que la empresa ha comprendido.
 * Lo que cambia de idioma es la interfaz que lo rodea.
 */
export function InsightsPage() {
  const insights = useResource(() => api<Insight[]>('/insights?limit=50'));
  const t = useT();
  usePageTitle('nav.insights');
  const labels = useLabels();
  const formatDate = useFormatDate();

  return (
    <>
      <PageHeader
        title={t('nav.insights')}
        description={t('page.insights.subtitle')}
      />

      <Card title={t('insights.title', { count: insights.data?.length ?? 0 })}>
        <ErrorNote error={insights.error} />
        {insights.loading && <Empty>{t('common.loading')}</Empty>}
        {!insights.loading && (insights.data?.length ?? 0) === 0 && (
          <Empty>{t('insights.empty')}</Empty>
        )}

        <ul className="divide-y divide-line">
          {insights.data?.map((insight) => (
            <li key={insight.id} className="py-4 first:pt-0 last:pb-0">
              <Link
                to={`/insights/${insight.id}`}
                className="block t-body font-medium text-ink transition-colors hover:text-accent"
              >
                {insight.summary}
              </Link>

              <div className="mt-2 flex flex-wrap items-center gap-2 t-fine text-muted">
                <Badge>{labels.insightType(insight.type)}</Badge>
                <span>
                  {labels.confidence(insight.confidence)}
                </span>
                <FreshnessBadge insight={insight} />
                <CurationBadge insight={insight} />
                <span className="text-faint">
                  {formatDate(insight.createdAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

export function FreshnessBadge({ insight }: { insight: Insight }) {
  const t = useT();

  if (insight.freshness === 'FRESH') {
    return <Badge tone="good">{t('insight.badge.freshEvidence')}</Badge>;
  }
  return (
    <Badge tone={insight.freshness === 'STALE' ? 'warn' : 'bad'}>
      {insight.freshness === 'STALE'
        ? t('insight.badge.evidenceChanged')
        : t('insight.badge.evidenceUnresolvable')}
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
  const t = useT();
  const { curation } = insight;
  if (!curation) return null;

  if (curation.disputed) {
    return <Badge tone="bad">{t('insight.badge.disputed')}</Badge>;
  }
  if (curation.origin === 'INHERITED') {
    return <Badge tone="warn">{t('insight.badge.inherited')}</Badge>;
  }
  return <Badge tone="good">{t('insight.badge.curated')}</Badge>;
}

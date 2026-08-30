import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { hasRole, type AnalysisRun } from '../api/types';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  PageHeader,
  Table,
  useAction,
  useFormatDate,
  usePageTitle,
  useResource,
} from '../components/ui';
import { useT } from '../i18n';
import { useLabels } from '../i18n/labels';

/**
 * Análisis: pedirle al motor que razone ahora.
 *
 * Lanzar un análisis exige ADMIN y el backend además reserva el hueco: un doble clic o el
 * reintento de un proxy no producen dos ejecuciones. Aquí solo se deshabilita el botón
 * mientras dura; quien decide de verdad es el servidor.
 */
export function AnalysisPage() {
  const { role } = useAuth();
  const t = useT();
  usePageTitle('nav.analysis');
  const labels = useLabels();
  const formatDate = useFormatDate();
  const canTrigger = hasRole(role, 'ADMIN');

  const runs = useResource(() =>
    canTrigger ? api<AnalysisRun[]>('/analysis-runs') : Promise.resolve([]),
  );
  const trigger = useAction();
  const [last, setLast] = useState<AnalysisRun | null>(null);

  if (!canTrigger) {
    return (
      <Card title={t('analysis.title')}>
        <Empty>{t('analysis.needsAdmin')}</Empty>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title={t('nav.analysis')} description={t('page.analysis.subtitle')} />

      <Card
        title={t('analysis.run.title')}
        actions={
          <Button
            disabled={trigger.busy}
            onClick={() =>
              void trigger
                .run(async () => {
                  const result = await api<AnalysisRun>('/analysis-runs', {
                    method: 'POST',
                    body: {},
                  });
                  setLast(result);
                })
                .then(runs.reload)
            }
          >
            {trigger.busy ? t('analysis.run.busy') : t('analysis.run.button')}
          </Button>
        }
      >
        <p className="t-fine text-muted">{t('analysis.run.explain')}</p>

        <ErrorNote error={trigger.error} />

        {last && (
          <p className="mt-3 rounded bg-sunken px-3 py-2 t-small">
            {t('analysis.result.summary', {
              created: last.insightsCreated ?? 0,
              known: last.insightsAlreadyKnown ?? 0,
              candidates: last.candidatesGenerated ?? 0,
            })}{' '}
            <Link className="text-accent underline" to="/insights">
              {t('analysis.result.seeInsights')}
            </Link>
            {(last.recommendationsProposed ?? 0) > 0 && (
              // La recomendacion es el resultado natural del analisis, no una pantalla
              // aparte a la que haya que acordarse de ir.
              <>
                {' · '}
                <Link
                  className="font-medium text-accent underline"
                  to="/recomendaciones"
                >
                  {t('analysis.result.proposals', {
                    count: last.recommendationsProposed ?? 0,
                  })}
                </Link>
              </>
            )}
          </p>
        )}
      </Card>

      <Card title={t('analysis.runs.title')}>
        <ErrorNote error={runs.error} />
        {runs.loading && <Empty>{t('common.loading')}</Empty>}
        {!runs.loading && (runs.data?.length ?? 0) === 0 && (
          <Empty>{t('analysis.runs.empty')}</Empty>
        )}

        {(runs.data?.length ?? 0) > 0 && (
          <Table
            head={[
              t('analysis.runs.column.status'),
              t('analysis.runs.column.origin'),
              t('analysis.runs.column.started'),
              t('analysis.runs.column.finished'),
            ]}
          >
            {runs.data?.map((run) => (
              <tr
                key={run.id ?? run.analysisRunId}
                className="border-b border-line last:border-0"
              >
                <td className="px-2 py-2">
                  <Badge tone={run.status === 'SUCCESS' ? 'good' : 'warn'}>
                    {labels.runStatus(run.status)}
                  </Badge>
                </td>
                <td className="px-2 py-2 t-fine text-muted">
                  {run.trigger === 'PERIODIC_SWEEP'
                    ? t('analysis.trigger.automatic')
                    : t('analysis.trigger.manual')}
                </td>
                <td className="px-2 py-2 t-fine text-muted">
                  {formatDate(run.startedAt ?? run.createdAt)}
                </td>
                <td className="px-2 py-2 t-fine text-muted">
                  {formatDate(run.finishedAt)}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

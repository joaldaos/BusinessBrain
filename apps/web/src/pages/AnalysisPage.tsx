import { runStatusLabel } from '../api/labels';
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
  Table,
  formatDate,
  useAction,
  useResource,
} from '../components/ui';

/**
 * Análisis: pedirle al motor que razone ahora.
 *
 * Lanzar un análisis exige ADMIN y el backend además reserva el hueco: un doble clic o el
 * reintento de un proxy no producen dos ejecuciones. Aquí solo se deshabilita el botón
 * mientras dura; quien decide de verdad es el servidor.
 */
export function AnalysisPage() {
  const { role } = useAuth();
  const canTrigger = hasRole(role, 'ADMIN');

  const runs = useResource(() =>
    canTrigger ? api<AnalysisRun[]>('/analysis-runs') : Promise.resolve([]),
  );
  const trigger = useAction();
  const [last, setLast] = useState<AnalysisRun | null>(null);

  if (!canTrigger) {
    return (
      <Card title="Análisis">
        <Empty>
          Lanzar y consultar análisis requiere permisos de administración en
          esta organización.
        </Empty>
      </Card>
    );
  }

  return (
    <>
      <Card
        title="Lanzar un análisis"
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
            {trigger.busy ? 'Analizando…' : 'Analizar ahora'}
          </Button>
        }
      >
        <p className="text-xs text-gray-500">
          El motor recorre el conocimiento indexado, deriva conclusiones y las
          reconcilia con lo que ya creía. Si una conclusión cambia, la anterior
          no se borra: queda como versión superada.
        </p>

        <ErrorNote error={trigger.error} />

        {last && (
          <p className="mt-3 rounded bg-gray-50 px-3 py-2 text-sm">
            {last.insightsCreated ?? 0} conclusión(es) nueva(s) ·{' '}
            {last.insightsAlreadyKnown ?? 0} ya conocida(s) ·{' '}
            {last.candidatesGenerated ?? 0} candidato(s) evaluado(s).{' '}
            <Link className="text-blue-700 underline" to="/insights">
              Ver comprensión
            </Link>
            {(last.recommendationsProposed ?? 0) > 0 && (
              // La recomendacion es el resultado natural del analisis, no una pantalla
              // aparte a la que haya que acordarse de ir.
              <>
                {' · '}
                <Link
                  className="font-medium text-blue-700 underline"
                  to="/recomendaciones"
                >
                  {last.recommendationsProposed} recomendación(es) para revisar
                </Link>
              </>
            )}
          </p>
        )}
      </Card>

      <Card title="Ejecuciones">
        <ErrorNote error={runs.error} />
        {runs.loading && <Empty>Cargando…</Empty>}
        {!runs.loading && (runs.data?.length ?? 0) === 0 && (
          <Empty>Todavía no se ha ejecutado ningún análisis.</Empty>
        )}

        {(runs.data?.length ?? 0) > 0 && (
          <Table head={['Estado', 'Origen', 'Inicio', 'Fin']}>
            {runs.data?.map((run) => (
              <tr
                key={run.id ?? run.analysisRunId}
                className="border-b border-gray-100 last:border-0"
              >
                <td className="px-2 py-2">
                  <Badge tone={run.status === 'SUCCESS' ? 'good' : 'warn'}>
                    {runStatusLabel(run.status)}
                  </Badge>
                </td>
                <td className="px-2 py-2 text-xs text-gray-600">
                  {run.trigger === 'PERIODIC_SWEEP'
                    ? 'automático'
                    : 'manual'}
                </td>
                <td className="px-2 py-2 text-xs text-gray-600">
                  {formatDate(run.startedAt ?? run.createdAt)}
                </td>
                <td className="px-2 py-2 text-xs text-gray-600">
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

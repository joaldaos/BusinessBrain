import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { BeliefHistory, Insight } from '../api/types';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  formatDate,
  inputClass,
  useAction,
  useResource,
} from '../components/ui';
import { CurationBadge, FreshnessBadge } from './InsightsPage';

/**
 * Una conclusión: en qué se apoya, qué se ha decidido sobre ella y cómo ha cambiado.
 *
 * Reúne las tres capacidades del motor que solo tenían sentido juntas: la conclusión con su
 * evidencia, la curación humana, y la **historia de la creencia** — qué se creía antes y qué
 * evidencia exacta lo movió.
 */
export function InsightDetailPage() {
  const { insightId = '' } = useParams();
  const insight = useResource(
    () => api<Insight>(`/insights/${insightId}`),
    [insightId],
  );
  const history = useResource(
    () => api<BeliefHistory>(`/insights/${insightId}/history`),
    [insightId],
  );

  if (insight.loading) return <Empty>Cargando…</Empty>;
  if (insight.error) return <ErrorNote error={insight.error} />;
  if (!insight.data) return <Empty>No encontrada.</Empty>;

  const data = insight.data;

  return (
    <>
      <Card title="Conclusión">
        <p className="text-sm">{data.summary}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <Badge>{data.type}</Badge>
          <span>confianza {data.confidence.toFixed(2)}</span>
          <FreshnessBadge insight={data} />
          <CurationBadge insight={data} />
          <span className="text-gray-400">{formatDate(data.createdAt)}</span>
        </div>

        <p className="mt-2 text-xs text-gray-500">{data.freshnessRationale}</p>

        {data.curation && (
          <p className="mt-2 text-xs text-gray-600">
            {data.curation.origin === 'OWN'
              ? 'Validada sobre esta misma versión'
              : 'Validada sobre una versión anterior de esta creencia'}{' '}
            el {formatDate(data.curation.at)}.
            {data.curation.comment && ` «${data.curation.comment}»`}
            {data.curation.disputed &&
              ' La evidencia posterior contradice lo que se validó.'}
          </p>
        )}

        {data.businessObjectives.length > 0 && (
          <p className="mt-2 text-xs text-gray-600">
            Importa porque:{' '}
            {data.businessObjectives.map((o) => o.statement).join(' · ')}
          </p>
        )}

        <div className="mt-3">
          <p className="text-xs font-medium text-gray-700">
            Evidencia ({data.evidence.length})
          </p>
          <ul className="mt-1 space-y-1 text-xs text-gray-600">
            {data.evidence.map((piece, index) => (
              <li key={`${piece.refId}-${index}`}>
                {piece.role} · {piece.kind} · {piece.refId}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <CurateCard
        insightId={insightId}
        onDone={() => {
          insight.reload();
          history.reload();
        }}
      />

      <HistoryCard history={history.data} error={history.error} loading={history.loading} />
    </>
  );
}

function CurateCard({
  insightId,
  onDone,
}: {
  insightId: string;
  onDone: () => void;
}) {
  const [type, setType] = useState<'CONFIRMATION' | 'DISMISSAL' | 'CORRECTION'>(
    'CONFIRMATION',
  );
  const [comment, setComment] = useState('');
  const action = useAction();
  const [done, setDone] = useState(false);

  return (
    <Card title="Tu decisión">
      <p className="mb-3 text-xs text-gray-500">
        Lo que decidas tiene prioridad sobre cualquier recálculo automático
        posterior, hasta que lo revoques. Descartarla la retira de la lectura
        habitual, sin borrar nada.
      </p>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={action.onSubmit(async () => {
          await api(`/insights/${insightId}/curate`, {
            method: 'POST',
            body: { type, comment: comment || undefined },
          });
          setComment('');
          setDone(true);
          onDone();
        })}
      >
        <div className="min-w-40">
          <Field label="Decisión">
            <select
              className={inputClass}
              value={type}
              onChange={(e) =>
                setType(e.target.value as typeof type)
              }
            >
              <option value="CONFIRMATION">La confirmo</option>
              <option value="CORRECTION">La corrijo</option>
              <option value="DISMISSAL">La descarto</option>
            </select>
          </Field>
        </div>
        <div className="min-w-56 flex-1">
          <Field label="Comentario (opcional)">
            <input
              className={inputClass}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
        </div>
        <Button type="submit" disabled={action.busy}>
          Registrar
        </Button>
      </form>

      <ErrorNote error={action.error} />
      {done && !action.error && (
        <p className="mt-2 text-xs text-green-700">Decisión registrada.</p>
      )}
    </Card>
  );
}

/**
 * Historia de la creencia.
 *
 * El orden lo da la cadena de supersesión, no el reloj — el backend ya lo garantiza. Aquí solo
 * se pinta, incluidos los dos recuentos que nunca deben ocultarse: versiones que el lector no
 * puede ver y cambios de evidencia fuera de su alcance. Omitirlos presentaría una historia
 * incompleta como si fuera completa.
 */
function HistoryCard({
  history,
  error,
  loading,
}: {
  history: BeliefHistory | null;
  error: unknown;
  loading: boolean;
}) {
  return (
    <Card title="Cómo ha cambiado esta creencia">
      <ErrorNote error={error} />
      {loading && <Empty>Cargando…</Empty>}
      {history && history.versions.length === 0 && (
        <Empty>No hay ninguna versión visible dentro de tu alcance.</Empty>
      )}

      {history && history.versions.length > 0 && (
        <>
          <ol className="space-y-3">
            {history.versions.map((version, index) => {
              const transition = history.transitions[index - 1];
              return (
                <li key={version.id} className="border-l-2 border-gray-200 pl-3">
                  <p className="text-sm">{version.summary}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                    <Badge tone={version.status === 'ACTIVE' ? 'good' : 'neutral'}>
                      {version.status === 'ACTIVE' ? 'versión actual' : 'superada'}
                    </Badge>
                    <span>confianza {version.confidence.toFixed(2)}</span>
                    <span>{version.evidenceCount} evidencia(s)</span>
                    <span className="text-gray-400">
                      {formatDate(version.createdAt)}
                    </span>
                  </p>

                  {transition && (
                    <div className="mt-2 rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-700">
                      <p>
                        La confianza{' '}
                        {transition.confidenceDelta >= 0 ? 'subió' : 'bajó'}{' '}
                        {Math.abs(transition.confidenceDelta).toFixed(2)} porque:
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {transition.changes.map((change, i) => (
                          <li key={`${change.ref.refId}-${i}`}>
                            {describeChange(change.kind)} · {change.ref.refId}
                          </li>
                        ))}
                      </ul>
                      {transition.changesOutOfScope > 0 && (
                        <p className="mt-1 text-gray-500">
                          Y {transition.changesOutOfScope} cambio(s) más fuera de
                          tu alcance, que no podemos detallarte.
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {history.hiddenVersionCount > 0 && (
            <p className="mt-3 text-xs text-gray-500">
              Hay {history.hiddenVersionCount} versión(es) de esta creencia que
              no puedes ver con tu alcance actual.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function describeChange(kind: string): string {
  switch (kind) {
    case 'ENTERED':
      return 'entró evidencia nueva';
    case 'LEFT':
      return 'dejó de sostenerla';
    case 'CONTRADICTED':
      return 'la contradijo';
    case 'SUPERSEDED_EVIDENCE':
      return 'su fuente fue reemplazada';
    default:
      return kind;
  }
}

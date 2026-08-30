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
  inputClass,
  useAction,
  useFormatDate,
  useResource,
} from '../components/ui';
import { CurationBadge, FreshnessBadge } from './InsightsPage';
import { useT, type TranslationKey } from '../i18n';
import { useLabels } from '../i18n/labels';

/**
 * Una conclusión: en qué se apoya, qué se ha decidido sobre ella y cómo ha cambiado.
 *
 * Reúne las tres capacidades del motor que solo tenían sentido juntas: la conclusión con su
 * evidencia, la curación humana, y la **historia de la creencia** — qué se creía antes y qué
 * evidencia exacta lo movió.
 *
 * El resumen de cada versión y el comentario de quien la validó son contenido de la empresa:
 * se muestran tal cual, en el idioma en que se escribieron.
 */
export function InsightDetailPage() {
  const { insightId = '' } = useParams();
  const t = useT();
  const labels = useLabels();
  const formatDate = useFormatDate();

  const insight = useResource(
    () => api<Insight>(`/insights/${insightId}`),
    [insightId],
  );
  const history = useResource(
    () => api<BeliefHistory>(`/insights/${insightId}/history`),
    [insightId],
  );

  // Solo se muestra el estado de carga cuando NO hay nada que enseñar todavía.
  //
  // Vaciar la pantalla en cada recarga desmontaría los formularios y perdería lo que la
  // persona acababa de hacer: el mensaje de "decisión registrada" desaparecía antes de que
  // nadie pudiera leerlo, y un comentario a medio escribir se perdía al recargar.
  if (insight.loading && !insight.data) return <Empty>{t('common.loading')}</Empty>;
  if (insight.error && !insight.data) return <ErrorNote error={insight.error} />;
  if (!insight.data) return <Empty>{t('insight.notFound')}</Empty>;

  const data = insight.data;

  return (
    <>
      <Card title={t('insight.title')}>
        <p className="t-small">{data.summary}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2 t-fine text-muted">
          <Badge>{labels.insightType(data.type)}</Badge>
          <span>
            {t('common.confidence', { value: data.confidence.toFixed(2) })}
          </span>
          <FreshnessBadge insight={data} />
          <CurationBadge insight={data} />
          <span className="text-faint">{formatDate(data.createdAt)}</span>
        </div>

        <p className="mt-2 t-fine text-muted">{data.freshnessRationale}</p>

        {data.curation && (
          <p className="mt-2 t-fine text-muted">
            {data.curation.origin === 'OWN'
              ? t('insight.curatedOwn')
              : t('insight.curatedInherited')}{' '}
            {t('insight.curatedOn', { date: formatDate(data.curation.at) })}
            {data.curation.comment && ` «${data.curation.comment}»`}
            {data.curation.disputed && ` ${t('insight.curationDisputed')}`}
          </p>
        )}

        {data.businessObjectives.length > 0 && (
          <p className="mt-2 t-fine text-muted">
            {t('insight.mattersBecause')}{' '}
            {data.businessObjectives.map((o) => o.statement).join(' · ')}
          </p>
        )}

        <div className="mt-3">
          <p className="t-fine font-medium text-ink-soft">
            {t('insight.evidence', { count: data.evidence.length })}
          </p>
          <ul className="mt-1 space-y-1 t-fine text-muted">
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

      <HistoryCard
        history={history.data}
        error={history.error}
        loading={history.loading}
      />
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
  const t = useT();
  const [type, setType] = useState<'CONFIRMATION' | 'DISMISSAL' | 'CORRECTION'>(
    'CONFIRMATION',
  );
  const [comment, setComment] = useState('');
  const action = useAction();
  const [done, setDone] = useState(false);

  return (
    <Card title={t('insight.decide.title')}>
      <p className="mb-3 t-fine text-muted">{t('insight.decide.explain')}</p>

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
          <Field label={t('insight.decide.field')}>
            <select
              className={inputClass}
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="CONFIRMATION">{t('insight.decide.confirm')}</option>
              <option value="CORRECTION">{t('insight.decide.correct')}</option>
              <option value="DISMISSAL">{t('insight.decide.dismiss')}</option>
            </select>
          </Field>
        </div>
        <div className="min-w-56 flex-1">
          <Field label={t('insight.decide.comment')}>
            <input
              className={inputClass}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
        </div>
        <Button type="submit" disabled={action.busy}>
          {t('insight.decide.submit')}
        </Button>
      </form>

      <ErrorNote error={action.error} />
      {done && !action.error && (
        <p className="mt-2 t-fine text-positive">{t('insight.decide.done')}</p>
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
  const t = useT();
  const formatDate = useFormatDate();

  return (
    <Card title={t('insight.history.title')}>
      <ErrorNote error={error} />
      {loading && <Empty>{t('common.loading')}</Empty>}
      {history && history.versions.length === 0 && (
        <Empty>{t('insight.history.empty')}</Empty>
      )}

      {history && history.versions.length > 0 && (
        <>
          <ol className="space-y-3">
            {history.versions.map((version, index) => {
              const transition = history.transitions[index - 1];
              return (
                <li key={version.id} className="border-l-2 border-line pl-3">
                  <p className="t-small">{version.summary}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 t-fine text-muted">
                    <Badge tone={version.status === 'ACTIVE' ? 'good' : 'neutral'}>
                      {version.status === 'ACTIVE'
                        ? t('insight.history.current')
                        : t('insight.history.superseded')}
                    </Badge>
                    <span>
                      {t('common.confidence', {
                        value: version.confidence.toFixed(2),
                      })}
                    </span>
                    <span>
                      {t('insight.history.evidenceCount', {
                        count: version.evidenceCount,
                      })}
                    </span>
                    <span className="text-faint">
                      {formatDate(version.createdAt)}
                    </span>
                  </p>

                  {transition && (
                    <div className="mt-2 rounded bg-sunken px-2 py-1.5 t-fine text-ink-soft">
                      {/* Dos frases enteras y no una con "subió"/"bajó" incrustado: en otro
                          idioma el verbo puede no ir en ese hueco. */}
                      <p>
                        {t(
                          transition.confidenceDelta >= 0
                            ? 'insight.history.confidenceRose'
                            : 'insight.history.confidenceFell',
                          {
                            delta: Math.abs(
                              transition.confidenceDelta,
                            ).toFixed(2),
                          },
                        )}
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {transition.changes.map((change, i) => (
                          <li key={`${change.ref.refId}-${i}`}>
                            {describeChange(t, change.kind)} · {change.ref.refId}
                          </li>
                        ))}
                      </ul>
                      {transition.changesOutOfScope > 0 && (
                        <p className="mt-1 text-muted">
                          {t('insight.history.outOfScope', {
                            count: transition.changesOutOfScope,
                          })}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {history.hiddenVersionCount > 0 && (
            <p className="mt-3 t-fine text-muted">
              {t('insight.history.hiddenVersions', {
                count: history.hiddenVersionCount,
              })}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * Qué movió la creencia, en palabras.
 *
 * Un tipo desconocido se devuelve tal cual: es feo y visible, que es justo lo que hace que
 * alguien lo arregle. La alternativa —una cadena vacía— desaparecería sin que nadie lo notara.
 */
function describeChange(
  t: (key: TranslationKey) => string,
  kind: string,
): string {
  const clave = `insight.change.${kind}` as TranslationKey;
  const texto = t(clave);
  return texto === clave ? kind : texto;
}

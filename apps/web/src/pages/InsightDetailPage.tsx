import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { BeliefHistory, Insight, KnowledgeItem } from '../api/types';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  PageHeader,
  Section,
  inputClass,
  useAction,
  useFormatDate,
  useFormatDay,
  usePageTitle,
  useResource,
} from '../components/ui';
import { CurationBadge, FreshnessBadge } from './InsightsPage';
import { useT, type TranslationKey } from '../i18n';
import { useLabels } from '../i18n/labels';
import { useHallazgo } from '../insights/lenguaje';

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
  const formatDay = useFormatDay();
  const comoHallazgo = useHallazgo();
  usePageTitle('nav.insights');

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
  const hallazgo = comoHallazgo(data);

  return (
    <>
      {/*
        ── NIVEL 1 ────────────────────────────────────────────────────────────

        Qué ha pasado → por qué importa → qué hacer. En ese orden, y con el titular como
        encabezado de la pantalla: antes esta página empezaba con una tarjeta llamada
        "Conclusión" y, dentro, la frase que compone el motor —«la confianza cayó a 0.64, por
        debajo del umbral 0.95»—. La pantalla, además, no tenía `h1`.
      */}
      <PageHeader title={hallazgo.titular} />

      <div className="space-y-4">
        <Section>
          {hallazgo.detectado && (
            <div className="mb-4">
              <p className="t-micro text-muted">{t('insight.finding.detected')}</p>
              <p className="mt-1 t-body text-ink-soft">{hallazgo.detectado}</p>
            </div>
          )}

          {hallazgo.porQueImporta && (
            <div className="mb-4">
              <p className="t-micro text-muted">{t('insight.finding.matters')}</p>
              <p className="mt-1 t-body text-ink-soft">{hallazgo.porQueImporta}</p>
            </div>
          )}

          {data.businessObjectives.length > 0 && (
            <div className="mb-4">
              <p className="t-micro text-muted">{t('insight.mattersBecause')}</p>
              <ul className="mt-1 space-y-0.5">
                {data.businessObjectives.map((objetivo) => (
                  <li key={objetivo.id} className="t-body text-ink-soft">
                    {objetivo.statement}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            {hallazgo.accion && (
              <Link
                to={hallazgo.accion.a}
                className="rounded-md bg-ink px-3.5 py-2 t-small font-medium text-white transition-colors hover:bg-ink-soft"
              >
                {hallazgo.accion.texto}
              </Link>
            )}
            <Badge>{labels.insightType(data.type)}</Badge>
            <FreshnessBadge insight={data} />
            <CurationBadge insight={data} />
            <span className="t-fine text-faint">{formatDay(data.createdAt)}</span>
          </div>

          {data.curation && (
            <p className="mt-3 t-small text-muted">
              {data.curation.origin === 'OWN'
                ? t('insight.curatedOwn')
                : t('insight.curatedInherited')}{' '}
              {t('insight.curatedOn', { date: formatDay(data.curation.at) })}
              {data.curation.comment && ` «${data.curation.comment}»`}
              {data.curation.disputed && ` ${t('insight.curationDisputed')}`}
            </p>
          )}
        </Section>

        {/* ── NIVEL 2: de dónde sale y cuánta seguridad tiene ─────────────── */}
        <Section title={t('insight.finding.source')}>
          <Evidencia insight={data} />

          <div className="mt-4 border-t border-line pt-4">
            <p className="t-micro text-muted">{t('insight.certainty.label')}</p>
            <p className="mt-1 t-body font-medium text-ink">
              {labels.confidence(data.confidence)}
            </p>
            {/*
              Con nombre y apellido. "Fiabilidad alta" a secas, junto a un texto que hablaba
              de un 0.64, se leía como una contradicción: son dos cosas distintas —la
              seguridad de la conclusión y la de un documento— que se llamaban igual.
            */}
            <p className="mt-1 max-w-xl t-small text-muted">
              {t('insight.certainty.explain')}
            </p>
          </div>

          <DetalleTecnico insight={data} />
        </Section>
      </div>

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

/**
 * En qué se apoya la conclusión, con los documentos por su nombre.
 *
 * Antes esto era una lista de `DEVIATION · KNOWLEDGE_ITEM · cmtfv...`: tres constantes
 * internas y un identificador que no significa nada para nadie. Los documentos se resuelven
 * contra `/knowledge-items`, que ya viene acotado por alcance — si una pieza de evidencia
 * cayera fuera del alcance de quien mira, aquí no aparecería su nombre, y eso es lo correcto.
 */
function Evidencia({ insight }: { insight: Insight }) {
  const t = useT();
  const labels = useLabels();
  const items = useResource(() => api<KnowledgeItem[]>('/knowledge-items'), []);

  if (insight.evidence.length === 0) {
    return <p className="t-small text-muted">{t('insight.evidence.none')}</p>;
  }

  return (
    <ul className="space-y-1.5">
      {insight.evidence.map((pieza, indice) => {
        const documento = items.data?.find((item) => item.id === pieza.refId);
        return (
          <li
            key={`${pieza.refId}-${indice}`}
            className="flex flex-wrap items-baseline gap-x-2 t-body text-ink-soft"
          >
            <span>{documento?.title ?? labels.evidenceKind(pieza.kind)}</span>
            <span className="t-fine text-muted">
              {labels.evidenceRole(pieza.role)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * El nivel 2 del nivel 2: lo que registró el motor, tal cual.
 *
 * No se tira nada. Quien tenga que comprobar por qué el sistema decidió esto —o pasárselo a
 * quien lleve sus sistemas— lo tiene aquí, incluido el resumen literal con sus números. Lo
 * que cambia es que ya no es lo primero que se lee.
 */
function DetalleTecnico({ insight }: { insight: Insight }) {
  const t = useT();
  const [abierto, setAbierto] = useState(false);

  return (
    <div className="mt-4 border-t border-line pt-4">
      <Button
        variant="ghost"
        aria-expanded={abierto}
        onClick={() => setAbierto(!abierto)}
      >
        {abierto ? t('insight.finding.detailHide') : t('insight.finding.detail')}
      </Button>

      {abierto && (
        <div className="mt-3 rounded-md bg-sunken p-4">
          <p className="t-fine text-muted">{t('insight.finding.detailWhy')}</p>
          <p className="mt-3 t-small text-ink-soft">{insight.summary}</p>
          {insight.freshnessRationale && (
            <p className="mt-2 t-small text-muted">
              {insight.freshnessRationale}
            </p>
          )}
          <ul className="mt-3 space-y-0.5 font-mono t-fine text-muted">
            {insight.evidence.map((pieza, indice) => (
              <li key={`${pieza.refId}-${indice}`}>
                {pieza.role} · {pieza.kind} · {pieza.refId}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
  const labels = useLabels();
  const formatDate = useFormatDate();
  /*
   * Plegado.
   *
   * Cada versión guarda el resumen que compuso el motor en su momento, con sus números y su
   * umbral, y ese texto NO se puede reescribir desde aquí: la historia no trae la traza de
   * cada versión, solo el texto ya compuesto. Inventarle un titular sería afirmar algo que
   * no sabemos, así que se enseña tal cual — pero detrás de su botón, no como lo último que
   * lee alguien que solo quería entender el hallazgo.
   */
  const [abierto, setAbierto] = useState(false);

  return (
    <Card
      title={t('insight.history.title')}
      actions={
        <Button
          variant="ghost"
          aria-expanded={abierto}
          onClick={() => setAbierto(!abierto)}
        >
          {abierto ? t('insight.history.hide') : t('insight.history.show')}
        </Button>
      }
    >
      {abierto && <ErrorNote error={error} />}
      {abierto && loading && <Empty>{t('common.loading')}</Empty>}
      {abierto && history && history.versions.length === 0 && (
        <Empty>{t('insight.history.empty')}</Empty>
      )}

      {abierto && history && history.versions.length > 0 && (
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
                      {t('insight.certainty.inline', {
                        level: labels.confidence(version.confidence),
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

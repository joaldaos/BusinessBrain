import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { hasRole, type Recommendation } from '../api/types';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  PageHeader,
  useAction,
  useFormatDate,
  usePageTitle,
  useResource,
} from '../components/ui';
import { useT } from '../i18n';
import { useLabels } from '../i18n/labels';

/**
 * Lo que BusinessBrain propone, y lo que la empresa decide.
 *
 * ## Por qué esta pantalla es el otro medio producto
 *
 * Preguntar es reactivo: hay que saber qué preguntar. Esto es lo contrario — el sistema mira lo
 * que sabe y dice "esto deberías revisarlo". Es la diferencia entre una herramienta que
 * consultas y una que trabaja para ti.
 *
 * ## Proponer no es hacer
 *
 * La pantalla lo dice explícitamente y en más de un sitio, porque es la garantía que sostiene
 * la confianza: aceptar registra una decisión y **no ejecuta nada**. Ni correos, ni cambios en
 * documentos, ni llamadas a terceros. Si algún día eso cambiara, tendría que cambiar aquí
 * primero.
 *
 * ## Quién la escribió importa
 *
 * Una propuesta del sistema y una redactada por un compañero no se leen igual. Se distinguen
 * siempre: presentar ambas como "recomendación" a secas ocultaría de quién es el criterio.
 *
 * ## El texto de la propuesta no se traduce
 *
 * Lo redactó el análisis a partir de los documentos de esta empresa, o lo escribió una persona
 * de dentro. Es contenido suyo. Lo que cambia de idioma son los rótulos que lo enmarcan.
 */
export function RecommendationsPage() {
  const { role } = useAuth();
  const t = useT();
  usePageTitle('nav.recommendations');
  const labels = useLabels();
  const formatDate = useFormatDate();
  const canDecide = hasRole(role, 'MEMBER');
  const [showResolved, setShowResolved] = useState(false);

  const pending = useResource(() =>
    api<Recommendation[]>('/recommendations?status=NEW'),
  );
  const resolved = useResource(
    () =>
      showResolved
        ? api<Recommendation[]>('/recommendations')
        : Promise.resolve([]),
    [showResolved],
  );

  const decided = (resolved.data ?? []).filter(
    (recommendation) => recommendation.status !== 'NEW',
  );

  return (
    <>
      <PageHeader title={t('nav.recommendations')} description={t('page.recommendations.subtitle')} />

      <Card
        title={t('recs.pending.title', { count: pending.data?.length ?? 0 })}
      >
        <p className="mb-3 t-fine text-muted">
          {t('recs.pending.governance')}
        </p>

        <ErrorNote error={pending.error} />
        {pending.loading && <Empty>{t('common.loading')}</Empty>}
        {!pending.loading && (pending.data?.length ?? 0) === 0 && (
          <Empty>{t('recs.pending.empty')}</Empty>
        )}

        <ul className="space-y-3">
          {pending.data?.map((recommendation) => (
            <RecommendationCard
              key={recommendation.id}
              recommendation={recommendation}
              canDecide={canDecide}
              onDecided={() => {
                pending.reload();
                resolved.reload();
              }}
            />
          ))}
        </ul>
      </Card>

      <Card title={t('recs.history.title')}>
        <Button
          variant="secondary"
          onClick={() => setShowResolved(!showResolved)}
        >
          {showResolved ? t('recs.history.hide') : t('recs.history.show')}
        </Button>

        {showResolved && (
          <>
            <ErrorNote error={resolved.error} />
            {decided.length === 0 && !resolved.loading && (
              // Descartar no borra: si no hay nada es que aún no se ha decidido nada.
              <Empty>{t('recs.history.empty')}</Empty>
            )}
            <ul className="mt-3 space-y-2">
              {decided.map((recommendation) => (
                <li
                  key={recommendation.id}
                  className="flex flex-wrap items-baseline gap-2 border-b border-line pb-2 t-small last:border-0"
                >
                  <Badge
                    tone={
                      recommendation.status === 'ACCEPTED' ? 'good' : 'neutral'
                    }
                  >
                    {labels.recommendationStatus(recommendation.status)}
                  </Badge>
                  <span>{recommendation.title}</span>
                  <span className="t-fine text-muted">
                    {recommendation.resolvedBy?.name ?? t('recs.someone')} ·{' '}
                    {formatDate(recommendation.resolvedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}

function RecommendationCard({
  recommendation,
  canDecide,
  onDecided,
}: {
  recommendation: Recommendation;
  canDecide: boolean;
  onDecided: () => void;
}) {
  const t = useT();
  const formatDate = useFormatDate();
  const [showEvidence, setShowEvidence] = useState(false);
  const action = useAction();

  const decide = (decision: 'accept' | 'dismiss') =>
    void action
      .run(() =>
        api(`/recommendations/${recommendation.id}/${decision}`, {
          method: 'POST',
        }),
      )
      .then(onDecided);

  return (
    <li className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="t-small font-semibold">{recommendation.title}</h3>
        {/* De quién es el criterio. Una propuesta del sistema y una de un compañero no se
            leen igual. */}
        <Badge tone={recommendation.createdById ? 'neutral' : 'good'}>
          {recommendation.createdById
            ? t('recs.author.person')
            : t('recs.author.system')}
        </Badge>
        <span className="t-fine text-muted">
          {formatDate(recommendation.createdAt)}
        </span>
      </div>

      <dl className="mt-3 grid gap-3 t-small sm:grid-cols-2">
        <Field
          label={t('recs.field.detected')}
          value={recommendation.detected}
        />
        <Field
          label={t('recs.field.justification')}
          value={recommendation.justification}
        />
        <Field
          label={t('recs.field.impact')}
          value={recommendation.estimatedImpact}
        />
        <Field
          label={t('recs.field.areas')}
          value={recommendation.affectedAreas}
        />
        <Field
          label={t('recs.field.advantages')}
          value={recommendation.advantages}
        />
        <Field
          label={t('recs.field.drawbacks')}
          value={recommendation.drawbacks}
        />
        <div className="sm:col-span-2">
          <Field
            label={t('recs.field.plan')}
            value={recommendation.migrationPlan}
          />
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setShowEvidence(!showEvidence)}>
          {showEvidence ? t('recs.evidence.hide') : t('recs.evidence.show')}
        </Button>

        {canDecide && (
          <>
            <Button disabled={action.busy} onClick={() => decide('accept')}>
              {action.busy ? t('common.saving') : t('recs.accept')}
            </Button>
            <Button
              variant="secondary"
              disabled={action.busy}
              onClick={() => decide('dismiss')}
            >
              {t('recs.dismiss')}
            </Button>
          </>
        )}
        {!canDecide && (
          <span className="t-fine text-muted">{t('recs.readOnly')}</span>
        )}
      </div>

      <ErrorNote error={action.error} />

      {showEvidence && (
        <div className="mt-3 rounded border border-line bg-sunken p-3 t-fine">
          <p className="font-medium text-ink-soft">{t('recs.evidence.why')}</p>
          {recommendation.sourceInsight ? (
            <p className="mt-1 text-muted">
              {t('recs.evidence.from')}{' '}
              <Link
                className="underline"
                to={`/insights/${recommendation.sourceInsight.id}`}
              >
                {recommendation.sourceInsight.summary}
              </Link>{' '}
              <span className="text-muted">
                {t('recs.evidence.openIt', {
                  confidence:
                    recommendation.sourceInsight.confidence.toFixed(2),
                })}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-attention">{t('recs.evidence.gone')}</p>
          )}
        </div>
      )}
    </li>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <div>
      <dt className="t-micro uppercase text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

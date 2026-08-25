import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type {
  AiConfiguration,
  Automation,
  Conversation,
  Insight,
  KnowledgeItem,
  KnowledgeSource,
  Report,
} from '../api/types';
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  useFormatDate,
  useResource,
} from '../components/ui';
import { useT, type TranslationKey } from '../i18n';
import { useLabels } from '../i18n/labels';

/**
 * Panel: en qué estado está la comprensión de la empresa ahora mismo.
 *
 * Cada número sale del mismo endpoint que su pantalla, no de un contador aparte: así lo que
 * se enseña aquí no puede divergir de lo que se ve al entrar.
 */
export function DashboardPage() {
  const t = useT();
  const labels = useLabels();
  const formatDate = useFormatDate();

  const insights = useResource(() => api<Insight[]>('/insights?limit=5'));
  const items = useResource(() => api<KnowledgeItem[]>('/knowledge-items'));
  const automations = useResource(() => api<Automation[]>('/automations'));
  const reports = useResource(() => api<Report[]>('/reports'));
  const sources = useResource(() => api<KnowledgeSource[]>('/knowledge-sources'));
  const ai = useResource(() => api<AiConfiguration>('/ai-configuration'));
  const conversations = useResource(() => api<Conversation[]>('/conversations'));

  const disputed =
    insights.data?.filter((insight) => insight.curation?.disputed) ?? [];
  const stale =
    insights.data?.filter((insight) => insight.freshness !== 'FRESH') ?? [];

  return (
    <>
      <FirstSteps
        aiReady={ai.data?.ready ?? false}
        connected={(sources.data?.length ?? 0) > 0}
        learned={(items.data?.length ?? 0) > 0}
        asked={(conversations.data?.length ?? 0) > 0}
        understood={(insights.data?.length ?? 0) > 0}
        loading={sources.loading || items.loading || ai.loading}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric
          label={t('dashboard.metric.documents')}
          value={items.data?.length}
          to="/conocimiento"
        />
        <Metric
          label={t('dashboard.metric.conclusions')}
          value={insights.data?.length}
          to="/insights"
        />
        <Metric
          label={t('dashboard.metric.automations')}
          value={automations.data?.length}
          to="/automatizaciones"
        />
        <Metric
          label={t('dashboard.metric.reports')}
          value={reports.data?.length}
          to="/informes"
        />
      </div>

      <ErrorNote error={insights.error ?? items.error} />

      {(disputed.length > 0 || stale.length > 0) && (
        <Card title={t('dashboard.attention.title')}>
          <ul className="space-y-2 text-sm">
            {disputed.map((insight) => (
              <li key={`d-${insight.id}`}>
                <Link className="text-blue-700 underline" to={`/insights/${insight.id}`}>
                  {insight.summary}
                </Link>{' '}
                <Badge tone="bad">{t('insight.badge.disputed')}</Badge>
                <p className="text-xs text-gray-500">
                  {t('dashboard.attention.disputedWhy')}
                </p>
              </li>
            ))}
            {stale.map((insight) => (
              <li key={`s-${insight.id}`}>
                <Link className="text-blue-700 underline" to={`/insights/${insight.id}`}>
                  {insight.summary}
                </Link>{' '}
                <Badge tone="warn">{labels.freshness(insight.freshness)}</Badge>
                {/* La explicación la redacta el motor a partir de la evidencia de esta
                    empresa: es contenido suyo y se muestra tal cual. */}
                <p className="text-xs text-gray-500">
                  {insight.freshnessRationale}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={t('dashboard.latest.title')}>
        {insights.loading && <Empty>{t('common.loading')}</Empty>}
        {!insights.loading && (insights.data?.length ?? 0) === 0 && (
          <Empty>{t('dashboard.latest.empty')}</Empty>
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
                <Badge>{labels.insightType(insight.type)}</Badge>
                <span>
                  {t('common.confidence', {
                    value: insight.confidence.toFixed(2),
                  })}
                </span>
                <span>· {formatDate(insight.createdAt)}</span>
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

/**
 * Los primeros pasos, con el estado REAL de la cuenta.
 *
 * Una PYME que entra por primera vez ve un panel vacío y no sabe si el producto no funciona o
 * si es que aún no le ha dado nada. Esto responde a eso, y desaparece en cuanto sobra: no es un
 * tutorial que haya que cerrar, es la lista de lo que falta para que el sistema sirva.
 *
 * Cada paso se decide con los mismos endpoints que su pantalla, nunca con un contador aparte:
 * un tutorial que se marca solo como completado es peor que no tenerlo.
 */
function FirstSteps({
  aiReady,
  connected,
  learned,
  asked,
  understood,
  loading,
}: {
  aiReady: boolean;
  connected: boolean;
  learned: boolean;
  asked: boolean;
  understood: boolean;
  loading: boolean;
}) {
  const t = useT();

  // Los pasos guardan CLAVES, no frases: la lista es estructura, no texto.
  const steps: {
    done: boolean;
    to: string;
    action: TranslationKey;
    why: TranslationKey;
  }[] = [
    {
      // Primero de la lista porque bloquea a todos los demás: sin IA, lo que se suba no se
      // puede preguntar y un análisis no encuentra nada.
      done: aiReady,
      to: '/configuracion',
      action: 'dashboard.steps.ai.action',
      why: 'dashboard.steps.ai.why',
    },
    {
      done: connected,
      to: '/conocimiento',
      action: 'dashboard.steps.source.action',
      why: 'dashboard.steps.source.why',
    },
    {
      done: learned,
      to: '/conocimiento',
      action: 'dashboard.steps.sync.action',
      why: 'dashboard.steps.sync.why',
    },
    {
      done: asked,
      to: '/preguntar',
      action: 'dashboard.steps.ask.action',
      why: 'dashboard.steps.ask.why',
    },
    {
      done: understood,
      to: '/analisis',
      action: 'dashboard.steps.analysis.action',
      why: 'dashboard.steps.analysis.why',
    },
  ];

  // Todo hecho: la tarjeta se retira sola. Y mientras carga tampoco se enseña, para no decirle
  // a alguien que le falta un paso que ya había dado.
  if (loading || steps.every((step) => step.done)) return null;

  return (
    <Card title={t('dashboard.steps.title')}>
      <p className="mb-3 text-xs text-gray-500">
        {t('dashboard.steps.progress', {
          done: steps.filter((step) => step.done).length,
          total: steps.length,
        })}
      </p>
      <ol className="space-y-2 text-sm">
        {steps.map((step) => (
          <li key={step.action} className="flex flex-wrap items-baseline gap-2">
            <span aria-hidden className={step.done ? 'text-green-600' : 'text-gray-300'}>
              ●
            </span>
            {step.done ? (
              <span className="text-gray-400 line-through">{t(step.action)}</span>
            ) : (
              <Link className="font-medium text-blue-700 underline" to={step.to}>
                {t(step.action)}
              </Link>
            )}
            {!step.done && (
              <span className="text-xs text-gray-500">{t(step.why)}</span>
            )}
          </li>
        ))}
      </ol>
    </Card>
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

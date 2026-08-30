import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
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
  ErrorNote,
  Metric,
  PageHeader,
  Section,
  Skeleton,
  useFormatDate,
  usePageTitle,
  useResource,
} from '../components/ui';
import { useT, type TranslationKey } from '../i18n';
import { useLabels } from '../i18n/labels';

/**
 * El panel: en qué estado está la comprensión de la empresa ahora mismo.
 *
 * ## Las cuatro preguntas que responde, en este orden
 *
 * **Dónde estoy** — el nombre de la empresa como título de la pantalla. Antes solo aparecía
 * dentro de un desplegable de la cabecera, así que la pantalla más importante del producto no
 * decía de quién estaba hablando.
 *
 * **Qué me falta** — los primeros pasos, arriba del todo mientras queden. No es un tutorial
 * que haya que cerrar: es la lista de lo que impide que el producto sirva, y desaparece sola.
 *
 * **Qué necesita atención** — conclusiones en disputa o desactualizadas.
 *
 * **Qué ha encontrado** — lo último comprendido.
 *
 * ## Cada número sale del mismo sitio que su pantalla
 *
 * No hay un contador aparte. Lo que se enseña aquí no puede divergir de lo que se ve al
 * entrar en la sección, que es como los paneles empiezan a mentir.
 */
export function DashboardPage() {
  const t = useT();
  const labels = useLabels();
  const formatDate = useFormatDate();
  const { organizations, organizationId } = useAuth();
  usePageTitle('nav.dashboard');

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

  const empresa =
    organizations.find((org) => org.id === organizationId)?.name ?? '';
  const cargando = sources.loading || items.loading || ai.loading;

  return (
    <>
      <PageHeader
        title={empresa}
        description={t('dashboard.subtitle')}
      />

      <FirstSteps
        aiReady={ai.data?.ready ?? false}
        connected={(sources.data?.length ?? 0) > 0}
        learned={(items.data?.length ?? 0) > 0}
        asked={(conversations.data?.length ?? 0) > 0}
        understood={(insights.data?.length ?? 0) > 0}
        loading={cargando}
      />

      {/*
        Las cifras van DESPUÉS de los primeros pasos mientras haya pasos: cuatro ceros no
        ayudan a nadie que todavía no ha subido nada, y los pasos sí.
      */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label={t('dashboard.metric.documents')}
          value={items.data?.length ?? 0}
          emptyHint={t('dashboard.metric.documentsEmpty')}
          href="/conocimiento"
        />
        <Metric
          label={t('dashboard.metric.conclusions')}
          value={insights.data?.length ?? 0}
          emptyHint={t('dashboard.metric.conclusionsEmpty')}
          href="/insights"
        />
        <Metric
          label={t('dashboard.metric.automations')}
          value={automations.data?.length ?? 0}
          emptyHint={t('dashboard.metric.automationsEmpty')}
          href="/automatizaciones"
        />
        <Metric
          label={t('dashboard.metric.reports')}
          value={reports.data?.length ?? 0}
          emptyHint={t('dashboard.metric.reportsEmpty')}
          href="/informes"
        />
      </div>

      <div className="mt-3">
        <ErrorNote error={insights.error ?? items.error} />
      </div>

      {(disputed.length > 0 || stale.length > 0) && (
        <div className="mt-6">
          <Section
            title={t('dashboard.attention.title')}
            description={t('dashboard.attention.subtitle')}
          >
            <ul className="space-y-4">
              {disputed.map((insight) => (
                <li key={`d-${insight.id}`}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link
                      className="t-body font-medium text-ink hover:text-accent"
                      to={`/insights/${insight.id}`}
                    >
                      {insight.summary}
                    </Link>
                    <Badge tone="bad">{t('insight.badge.disputed')}</Badge>
                  </div>
                  <p className="mt-1 t-small text-muted">
                    {t('dashboard.attention.disputedWhy')}
                  </p>
                </li>
              ))}
              {stale.map((insight) => (
                <li key={`s-${insight.id}`}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link
                      className="t-body font-medium text-ink hover:text-accent"
                      to={`/insights/${insight.id}`}
                    >
                      {insight.summary}
                    </Link>
                    <Badge tone="warn">{labels.freshness(insight.freshness)}</Badge>
                  </div>
                  {/* La explicación la redacta el motor a partir de la evidencia de esta
                      empresa: es contenido suyo y se muestra tal cual. */}
                  <p className="mt-1 t-small text-muted">
                    {insight.freshnessRationale}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}

      <div className="mt-6">
        <Section
          title={t('dashboard.latest.title')}
          description={t('dashboard.latest.subtitle')}
          actions={
            (insights.data?.length ?? 0) > 0 ? (
              <Link
                to="/insights"
                className="t-small font-medium text-accent hover:underline"
              >
                {t('dashboard.latest.seeAll')}
              </Link>
            ) : undefined
          }
        >
          {insights.loading ? (
            <Skeleton lines={3} />
          ) : (insights.data?.length ?? 0) === 0 ? (
            /*
              Un vacío que explica qué APARECERÁ aquí, no que diga "no hay datos". Quien
              acaba de crear su empresa necesita saber qué está a punto de pasar, no que algo
              está a cero.
            */
            <div className="py-6 text-center">
              <p className="t-body font-medium text-ink">
                {t('dashboard.latest.emptyTitle')}
              </p>
              <p className="mx-auto mt-1.5 max-w-md t-small text-muted">
                {t('dashboard.latest.emptyBody')}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {insights.data?.map((insight) => (
                <li key={insight.id} className="py-3 first:pt-0 last:pb-0">
                  <Link
                    to={`/insights/${insight.id}`}
                    className="t-body font-medium text-ink hover:text-accent"
                  >
                    {insight.summary}
                  </Link>
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 t-small text-muted">
                    <Badge>{labels.insightType(insight.type)}</Badge>
                    <span>
                      {t('common.confidence', {
                        value: insight.confidence.toFixed(2),
                      })}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{formatDate(insight.createdAt)}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

/**
 * Los primeros pasos, con el estado REAL de la cuenta.
 *
 * ## Por qué esto es lo primero de la pantalla
 *
 * Una PYME que entra por primera vez ve un panel vacío y no sabe si el producto no funciona o
 * si es que aún no le ha dado nada. Esto responde a eso, y desaparece en cuanto sobra.
 *
 * Cada paso se decide con los mismos endpoints que su pantalla, nunca con un contador aparte:
 * un tutorial que se marca solo como completado es peor que no tenerlo.
 *
 * ## Y desde la Fase 8 se ve el avance
 *
 * Antes eran cinco viñetas grises con enlaces subrayados y un "0 de 5" diminuto: la lista más
 * importante del producto parecía una nota al pie. Ahora hay una barra de progreso, cada paso
 * dice si está hecho, y **el siguiente pendiente destaca** — que es la única pregunta que
 * tiene quien mira esto: qué hago ahora.
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

  const hechos = steps.filter((step) => step.done).length;
  const siguiente = steps.find((step) => !step.done);

  return (
    <Section
      title={t('dashboard.steps.title')}
      description={t('dashboard.steps.subtitle')}
    >
      {/* El avance, visible. Una barra dice de un vistazo lo que "2 de 5" dice leyendo. */}
      <div className="mb-5 flex items-center gap-3">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuenow={hechos}
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-label={t('dashboard.steps.title')}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${(hechos / steps.length) * 100}%` }}
          />
        </div>
        <span className="t-small t-figure shrink-0 text-muted">
          {t('dashboard.steps.progress', { done: hechos, total: steps.length })}
        </span>
      </div>

      <ol className="space-y-1">
        {steps.map((step) => {
          const esSiguiente = step === siguiente;

          const contenido = (
            <>
              <StepMark done={step.done} />
              <span className="min-w-0">
                <span
                  className={`block t-body ${
                    step.done
                      ? 'text-muted line-through decoration-line'
                      : esSiguiente
                        ? 'font-medium text-accent'
                        : 'font-medium text-ink'
                  }`}
                >
                  {t(step.action)}
                </span>
                {!step.done && (
                  <span className="mt-0.5 block t-small text-muted">
                    {t(step.why)}
                  </span>
                )}
              </span>
            </>
          );

          return (
            <li key={step.action}>
              {/*
                Un paso HECHO no es un enlace.

                Se sigue viendo —tachado y con su marca— porque ver lo andado es la mitad de
                para qué sirve una lista de primeros pasos. Pero dejarlo pulsable lo convierte
                en una invitación a hacer algo que ya está hecho, y un lector de pantalla lo
                anuncia como "enlace, configura la inteligencia artificial" sin decir en
                ningún momento que ya está configurada: el tachado es puramente visual.
              */}
              {step.done ? (
                <span className="flex items-start gap-3 rounded-md px-3 py-2.5">
                  {contenido}
                </span>
              ) : (
                <Link
                  to={step.to}
                  className={`flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors ${
                    esSiguiente ? 'bg-accent-soft' : 'hover:bg-sunken'
                  }`}
                >
                  {contenido}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/** La marca de un paso: hecho o pendiente. Un círculo, no un carácter tipográfico. */
function StepMark({ done }: { done: boolean }) {
  if (done) {
    return (
      <span
        aria-hidden
        className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-positive-soft"
        style={{ width: '1.125rem', height: '1.125rem' }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M1.5 5.2l2.3 2.3L8.5 2.8"
            stroke="var(--color-positive)"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className="mt-0.5 shrink-0 rounded-full border-[1.5px] border-line-strong"
      style={{ width: '1.125rem', height: '1.125rem' }}
    />
  );
}

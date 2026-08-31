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
  Recommendation,
  Report,
} from '../api/types';
import {
  Badge,
  ErrorNote,
  Metric,
  PageHeader,
  Section,
  Skeleton,
  useFormatDay,
  usePageTitle,
  useResource,
} from '../components/ui';
import { useT, type TranslationKey } from '../i18n';
import { useLabels } from '../i18n/labels';
import { useHallazgo } from '../insights/lenguaje';

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
  const comoHallazgo = useHallazgo();
  const formatDay = useFormatDay();
  const { organizations, organizationId } = useAuth();
  usePageTitle('nav.dashboard');

  const insights = useResource(() => api<Insight[]>('/insights?limit=5'));
  const items = useResource(() => api<KnowledgeItem[]>('/knowledge-items'));
  const automations = useResource(() => api<Automation[]>('/automations'));
  const reports = useResource(() => api<Report[]>('/reports'));
  const sources = useResource(() => api<KnowledgeSource[]>('/knowledge-sources'));
  const ai = useResource(() => api<AiConfiguration>('/ai-configuration'));
  const conversations = useResource(() => api<Conversation[]>('/conversations'));
  // Lo que el sistema ha propuesto y nadie ha decidido todavía. Mismo endpoint que la
  // pantalla de Recomendaciones: el panel no puede contar una cifra distinta de la suya.
  const propuestasPendientes = useResource(() =>
    api<Recommendation[]>('/recommendations?status=NEW'),
  );

  const disputed =
    insights.data?.filter((insight) => insight.curation?.disputed) ?? [];
  const stale =
    insights.data?.filter((insight) => insight.freshness !== 'FRESH') ?? [];

  const empresa =
    organizations.find((org) => org.id === organizationId)?.name ?? '';
  const propuestas = propuestasPendientes.data ?? [];
  /** Todo lo que espera una decisión humana. Si es cero, no hay nada que hacer hoy. */
  const pendientes = propuestas.length + disputed.length + stale.length;

  const cargando =
    sources.loading ||
    items.loading ||
    ai.loading ||
    insights.loading ||
    propuestasPendientes.loading;

  /*
   * Los cinco primeros pasos, decididos aquí para que el resto de la pantalla sepa si la
   * empresa está todavía arrancando.
   *
   * Mientras queda algún paso, el panel es un onboarding y nada más: enseñar debajo "no hay
   * nada esperando por ti" y cuatro contadores a cero es decir tres veces lo mismo, y la
   * primera vez ya lo dijo mejor la lista de pasos.
   */
  const pasos = [
    ai.data?.ready ?? false,
    (sources.data?.length ?? 0) > 0,
    (items.data?.length ?? 0) > 0,
    (conversations.data?.length ?? 0) > 0,
    (insights.data?.length ?? 0) > 0,
  ];
  const arrancando = !cargando && pasos.some((hecho) => !hecho);

  return (
    <>
      <PageHeader
        title={empresa}
        description={t('dashboard.subtitle')}
      />

      <FirstSteps
        aiReady={pasos[0]}
        connected={pasos[1]}
        learned={pasos[2]}
        asked={pasos[3]}
        understood={pasos[4]}
        loading={cargando}
      />

      {/*
        ── 1. LO QUE ESPERA POR TI ──────────────────────────────────────────

        Antes esto no existía. El panel abría con cuatro contadores de filas —documentos,
        conclusiones, automatizaciones, informes— que no responden a ninguna pregunta que se
        haga quien entra por la mañana. Había dos recomendaciones esperando decisión y el
        panel no las mencionaba.

        Aquí va lo único que el sistema NO puede resolver solo, en orden de urgencia: lo que
        te ha propuesto, lo que alguien ha puesto en duda, y lo que ha dejado de encajar.
      */}
      {!cargando && !arrancando && (
        <div className="mt-6">
          <Section title={t('dashboard.todo.title')}>
            {pendientes === 0 ? (
              <div className="py-4">
                <p className="t-body font-medium text-ink">
                  {t('dashboard.calm.title')}
                </p>
                <p className="mt-1.5 max-w-xl t-small text-muted">
                  {t('dashboard.calm.body')}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {propuestas.length > 0 && (
                  <Espera
                    cantidad={propuestas.length}
                    titulo={t('dashboard.todo.recommendations')}
                    detalle={t('dashboard.todo.recommendationsWhy')}
                    a="/recomendaciones"
                    tono="accent"
                  />
                )}
                {disputed.length > 0 && (
                  <Espera
                    cantidad={disputed.length}
                    titulo={t('dashboard.todo.disputed')}
                    detalle={t('dashboard.attention.disputedWhy')}
                    a="/insights"
                    tono="danger"
                  />
                )}
                {stale.length > 0 && (
                  <Espera
                    cantidad={stale.length}
                    titulo={t('dashboard.todo.stale')}
                    detalle={t('dashboard.attention.subtitle')}
                    a="/insights"
                    tono="attention"
                  />
                )}
              </ul>
            )}
          </Section>
        </div>
      )}

      <div className="mt-3">
        <ErrorNote error={insights.error ?? items.error} />
      </div>

      {/*
        Mientras la empresa está arrancando, esto no se enseña: la lista de primeros pasos ya
        dice que hace falta un análisis y qué va a buscar. Repetirlo en una tarjeta vacía
        convierte el panel en tres formas distintas de decir "todavía no hay nada".
      */}
      {!arrancando && (
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
                    {comoHallazgo(insight).titular}
                  </Link>
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 t-small text-muted">
                    <Badge>{labels.insightType(insight.type)}</Badge>
                    <span>
                      {t('insight.certainty.inline', {
                        level: labels.confidence(insight.confidence),
                      })}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{formatDay(insight.createdAt)}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      )}

      {/*
        ── 3. LO QUE SABE, Y CÓMO PREGUNTARLE ────────────────────────────────

        Las cifras van al FINAL y solo cuando hay algo que contar. Cuatro ceros grandes al
        entrar por primera vez no informan de nada: dicen "aquí no hay nada" cuatro veces, y
        eso ya lo dicen los primeros pasos, mejor y con qué hacer al respecto.
      */}
      {!arrancando && !cargando && (items.data?.length ?? 0) > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label={t('dashboard.metric.documents')}
            value={items.data?.length ?? 0}
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
      )}
    </>
  );
}

/**
 * Una cosa que espera una decisión de una persona.
 *
 * La cifra manda: es lo que se lee de un vistazo desde el otro lado del escritorio. El tono
 * dice cuánto corre, y no hay más de tres tonos en toda la pantalla precisamente para que
 * signifiquen algo.
 */
function Espera({
  cantidad,
  titulo,
  detalle,
  a,
  tono,
}: {
  cantidad: number;
  titulo: string;
  detalle: string;
  a: string;
  tono: 'accent' | 'attention' | 'danger';
}) {
  const t = useT();
  const color = {
    accent: 'text-accent',
    attention: 'text-attention',
    danger: 'text-danger',
  }[tono];

  return (
    // En el móvil se apila: con todo en una fila, el texto quedaba en una columna de tres
    // palabras entre el número y el botón, y lo que explica qué hay que hacer es el texto.
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-x-4">
      <span className="flex min-w-0 flex-1 items-baseline gap-3">
        <span className={`t-figure t-display shrink-0 ${color}`}>{cantidad}</span>
        <span className="min-w-0">
          <span className="block t-body font-medium text-ink">{titulo}</span>
          <span className="mt-0.5 block t-small text-muted">{detalle}</span>
        </span>
      </span>
      <Link
        to={a}
        className="shrink-0 rounded-md bg-ink px-3.5 py-2 text-center t-small font-medium text-white transition-colors hover:bg-ink-soft"
      >
        {t('dashboard.todo.see')}
      </Link>
    </li>
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

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import {
  hasRole,
  type AnalysisRun,
  type BusinessObjective,
  type KnowledgeItem,
} from '../api/types';
import {
  Button,
  DataState,
  DataTable,
  EmptyState,
  ErrorNote,
  PageHeader,
  Section,
  StatusPill,
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
 *
 * ## Por qué esta pantalla enseña el RESULTADO antes que el botón
 *
 * Hasta la Fase 8.1 mostraba "Lanzar un análisis" con su botón, y debajo una tabla de
 * ejecuciones con cuatro columnas: estado, origen, inicio y fin. Ni una sola de las cuatro
 * dice lo que una PYME quiere saber, que es **qué sacó en claro**. El resultado —cuántas
 * conclusiones nuevas, cuántas actualizadas, cuántas recomendaciones— solo se veía durante
 * unos segundos después de pulsar, y al recargar la página desaparecía.
 *
 * Ahora lo primero es el último análisis y lo que produjo, con el camino directo a la
 * comprensión y a las recomendaciones. La tabla sigue existiendo, debajo, para quien quiera
 * el historial.
 *
 * ## Y por qué dice qué le falta
 *
 * Un análisis sobre cero documentos termina bien y no encuentra nada, lo cual es correcto y
 * completamente desconcertante. La pantalla comprueba antes las dos cosas de las que depende
 * —conocimiento leído y algún objetivo— y lo dice con el enlace para resolverlo.
 */
export function AnalysisPage() {
  const { role } = useAuth();
  const t = useT();
  usePageTitle('nav.analysis');
  const canTrigger = hasRole(role, 'ADMIN');

  if (!canTrigger) {
    // Antes esto era una tarjeta suelta SIN encabezado de pantalla: quien no es administrador
    // llegaba a una página sin `h1`, y un lector de pantalla no sabía ni dónde estaba.
    return (
      <>
        <PageHeader
          title={t('nav.analysis')}
          description={t('page.analysis.subtitle')}
        />
        <Section>
          <EmptyState title={t('analysis.needsAdmin.title')}>
            {t('analysis.needsAdmin.body')}
          </EmptyState>
        </Section>
      </>
    );
  }

  return <AnalysisAdmin />;
}

function AnalysisAdmin() {
  const t = useT();
  const labels = useLabels();
  const formatDate = useFormatDate();

  const runs = useResource(() => api<AnalysisRun[]>('/analysis-runs'));
  // Lo que el análisis NECESITA. Se pide igual que en el panel, sin endpoints nuevos.
  const items = useResource(() => api<KnowledgeItem[]>('/knowledge-items'));
  const objectives = useResource(() =>
    api<BusinessObjective[]>('/business-objectives'),
  );

  const trigger = useAction();
  // El resumen del disparo trae dos cosas que la fila guardada no sabe: cuántas ya conocía y
  // cuántas recomendaciones propuso. Se guarda para poder enseñarlas justo después.
  const [recien, setRecien] = useState<AnalysisRun | null>(null);

  const historial = runs.data ?? [];
  const ultimo = historial[0] ?? null;

  const hayConocimiento = (items.data ?? []).some(
    (item) => item.status === 'INDEXED',
  );
  const hayObjetivos = (objectives.data ?? []).some(
    (objective) => objective.status === 'CONFIRMED',
  );
  /**
   * Lo que de verdad impide analizar es no tener nada que leer.
   *
   * Sin objetivos el motor SÍ produce algo —patrones y anomalías—; lo que no puede es decir
   * si eso es un riesgo o una oportunidad (§8). Es una limitación, no un impedimento, y
   * esconder el botón por ella sería mentir sobre lo que el producto puede hacer.
   *
   * Sin conocimiento leído es distinto: el análisis termina bien, no encuentra nada porque no
   * hay nada, y quien lo pulsó se queda pensando que el producto no funciona.
   */
  const puedeAnalizar = hayConocimiento;
  const leFalta = !hayConocimiento || !hayObjetivos;

  const analizar = () =>
    void trigger
      .run(async () => {
        setRecien(
          await api<AnalysisRun>('/analysis-runs', { method: 'POST', body: {} }),
        );
      })
      .then(runs.reload);

  const boton = (
    <Button variant="primary" disabled={trigger.busy} onClick={analizar}>
      {trigger.busy ? t('analysis.run.busy') : t('analysis.run.button')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('nav.analysis')}
        description={t('page.analysis.subtitle')}
        actions={historial.length > 0 ? boton : undefined}
      />

      <ErrorNote error={trigger.error} />

      <div className="space-y-4">
        <DataState
          loading={runs.loading}
          error={runs.error}
          empty={historial.length === 0}
          onRetry={runs.reload}
          skeleton={4}
          emptyState={
            // UNA tarjeta, no dos.
            //
            // Al separarlas quedaba una caja grande que solo enunciaba un hecho —"todavía no
            // ha analizado tu empresa"— y debajo otra con lo único accionable. Dos tarjetas
            // para un solo mensaje: qué es esto y qué te falta para usarlo.
            <Section>
              <EmptyState
                title={t('analysis.empty.title')}
                // Si le falta conocimiento u objetivos, la acción NO es analizar.
                //
                // Ofrecerlo era una trampa: se pulsa, el análisis termina bien, no encuentra
                // nada —porque no hay nada que encontrar— y quien lo pulsó se queda pensando
                // que el producto no funciona. Lo que se ofrece es el paso que lleva a algo.
                action={puedeAnalizar ? boton : undefined}
              >
                {t('analysis.empty.body')}
              </EmptyState>

              {!items.loading && !objectives.loading && leFalta && (
                <div className="border-t border-line pt-5">
                  <Requisitos
                    conocimiento={hayConocimiento}
                    objetivos={hayObjetivos}
                  />
                </div>
              )}
            </Section>
          }
        >
          {ultimo && <UltimoAnalisis run={ultimo} resumen={recien} />}
        </DataState>

        {/*
          Con historial, lo que falta va en su propia tarjeta: ya hay un resultado arriba y
          esto es una advertencia sobre el siguiente análisis, no el contenido de la pantalla.
        */}
        {historial.length > 0 &&
          !items.loading &&
          !objectives.loading &&
          leFalta && (
            <Section>
              <Requisitos
                conocimiento={hayConocimiento}
                objetivos={hayObjetivos}
              />
            </Section>
          )}

        {historial.length > 1 && (
          <Section title={t('analysis.history.title')} flush>
            <DataTable
              head={[
                t('analysis.runs.column.status'),
                t('analysis.last.title'),
                t('analysis.runs.column.origin'),
                t('analysis.runs.column.finished'),
              ]}
            >
              {historial.slice(1).map((run) => (
                <tr key={run.id ?? run.analysisRunId}>
                  <td className="px-5 py-3">
                    <StatusPill
                      tone={run.status === 'SUCCESS' ? 'positive' : 'attention'}
                    >
                      {labels.runStatus(run.status)}
                    </StatusPill>
                  </td>
                  <td className="px-5 py-3 t-small text-ink-soft">
                    {t('analysis.history.summary', {
                      created: run.insightsCreated ?? 0,
                      updated: run.insightsSuperseded ?? 0,
                    })}
                  </td>
                  <td className="px-5 py-3 t-small text-muted">
                    {run.trigger === 'PERIODIC_SWEEP'
                      ? t('analysis.trigger.automatic')
                      : t('analysis.trigger.manual')}
                  </td>
                  <td className="px-5 py-3 t-small text-muted">
                    {formatDate(run.completedAt ?? run.createdAt)}
                  </td>
                </tr>
              ))}
            </DataTable>
          </Section>
        )}
      </div>
    </>
  );
}

/**
 * Lo que le falta al motor para poder analizar, con el camino a cada cosa.
 *
 * Se lleva el título dentro cuando va suelta dentro del estado vacío, y sin título cuando ya
 * va dentro de una tarjeta que lo dice.
 */
function Requisitos({
  conocimiento,
  objetivos,
}: {
  conocimiento: boolean;
  objetivos: boolean;
}) {
  const t = useT();

  return (
    <>
      <p className="mb-4 t-body font-medium text-ink">
        {t('analysis.needs.title')}
      </p>
      <ul className="space-y-4">
        {!conocimiento && (
          <Requisito
            titulo={t('analysis.needs.knowledge')}
            porque={t('analysis.needs.knowledgeWhy')}
            a="/conocimiento"
            accion={t('analysis.needs.go')}
          />
        )}
        {!objetivos && (
          <Requisito
            titulo={t('analysis.needs.objectives')}
            porque={t('analysis.needs.objectivesWhy')}
            a="/objetivos"
            accion={t('analysis.needs.goObjectives')}
          />
        )}
      </ul>
    </>
  );
}

/** Algo que falta, con el camino para resolverlo. Sin enlace sería un reproche. */
function Requisito({
  titulo,
  porque,
  a,
  accion,
}: {
  titulo: string;
  porque: string;
  a: string;
  accion: string;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 max-w-xl">
        <p className="t-body font-medium text-ink">{titulo}</p>
        <p className="mt-0.5 t-small text-muted">{porque}</p>
      </div>
      <Link
        to={a}
        className="shrink-0 rounded-md border border-line px-3 py-1.5 t-small font-medium text-ink transition-colors hover:border-line-strong hover:bg-sunken"
      >
        {accion}
      </Link>
    </li>
  );
}

/**
 * El último análisis, contado como resultado.
 *
 * `run` es la fila guardada —tiene fechas y cuántas conclusiones sustituyó— y `resumen` es lo
 * que devolvió el disparo si acaba de ocurrir en esta pantalla, que además sabe cuántas
 * recomendaciones propuso. Se combinan porque ninguna de las dos formas lo sabe todo.
 */
function UltimoAnalisis({
  run,
  resumen,
}: {
  run: AnalysisRun;
  resumen: AnalysisRun | null;
}) {
  const t = useT();
  const formatDate = useFormatDate();

  const mismaEjecucion =
    resumen != null && (resumen.analysisRunId ?? resumen.id) === run.id;

  const nuevas = run.insightsCreated ?? 0;
  const actualizadas = run.insightsSuperseded ?? 0;
  const propuestas = mismaEjecucion ? (resumen?.recommendationsProposed ?? 0) : 0;
  const fallo = run.status === 'FAILED';
  const enCurso = run.status === 'PENDING' || run.status === 'RUNNING';

  return (
    <Section title={t('analysis.last.title')}>
      {enCurso && (
        <p className="t-lead text-ink" role="status" aria-live="polite">
          <span className="bb-pulse">{t('analysis.last.running')}</span>
        </p>
      )}

      {fallo && (
        <p className="rounded-md border border-danger/25 bg-danger-soft px-4 py-2.5 t-small text-danger">
          {t('analysis.last.failed')}
        </p>
      )}

      {!enCurso && !fallo && (
        <>
          {nuevas === 0 && actualizadas === 0 ? (
            // Cero conclusiones nuevas NO es un error, y sin decirlo lo parece.
            <p className="t-lead text-ink-soft">
              {t('analysis.last.nothingNew')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-x-10 gap-y-4">
              <Cifra valor={nuevas} etiqueta={t('analysis.last.created')} />
              {actualizadas > 0 && (
                <Cifra
                  valor={actualizadas}
                  etiqueta={t('analysis.last.updated')}
                />
              )}
              {propuestas > 0 && (
                <Cifra
                  valor={propuestas}
                  etiqueta={t('analysis.last.proposals')}
                />
              )}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
            <Link
              to="/insights"
              className="t-small font-medium text-accent underline underline-offset-2"
            >
              {t('analysis.seeInsights')}
            </Link>
            {propuestas > 0 && (
              <Link
                to="/recomendaciones"
                className="t-small font-medium text-accent underline underline-offset-2"
              >
                {t('analysis.seeRecommendations')}
              </Link>
            )}
            <span className="t-fine text-muted">
              {t('analysis.last.when', {
                date: formatDate(run.completedAt ?? run.createdAt),
              })}
            </span>
          </div>
        </>
      )}
    </Section>
  );
}

/** Una cifra que importa: grande, y con lo que significa debajo. */
function Cifra({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div>
      <p className="t-display t-figure text-ink">
        {valor}
      </p>
      <p className="mt-1.5 t-small text-muted">{etiqueta}</p>
    </div>
  );
}

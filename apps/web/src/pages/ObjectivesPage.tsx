import { useState } from 'react';
import { api } from '../api/client';
import type { BusinessObjective } from '../api/types';
import {
  Button,
  DataState,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  Section,
  StatusPill,
  fieldClass,
  useAction,
  useFormatDay,
  usePageTitle,
  useResource,
} from '../components/ui';
import { useT } from '../i18n';

/**
 * Objetivos de negocio.
 *
 * ## Qué son, y por qué no son decorativos
 *
 * **Un hallazgo no puede clasificarse como riesgo u oportunidad si no hay un objetivo
 * confirmado que lo haga relevante** (§8). Sin objetivos, el motor solo produce patrones y
 * anomalías — describe lo que pasa, pero no dice si importa.
 *
 * Un objetivo declarado a mano nace ya confirmado: lo dijo una persona. Uno inferido por el
 * sistema nace como candidato y necesita que alguien lo confirme antes de poder anclar nada.
 *
 * ## Por qué la pantalla está ordenada así
 *
 * Hasta la Fase 8.1 esto era un formulario arriba y una tabla debajo: lo primero que veía
 * quien entraba era un campo vacío pidiéndole que escribiera algo, sin haberle dicho nunca
 * para qué sirve. Y los objetivos que el sistema había deducido —lo único que pide una
 * decisión— quedaban mezclados en la tabla con los demás, distinguidos por un distintivo
 * pequeño.
 *
 * Ahora manda el RESULTADO: qué objetivos hay y en qué estado. Después el CONTEXTO: qué
 * significan y de dónde salen. Y por último la ACCIÓN, que además está priorizada — lo que
 * espera confirmación va arriba del todo, porque es lo único que la pantalla necesita de ti.
 *
 * Crear uno nuevo es una acción de cabecera y su formulario solo aparece al pedirlo: no es lo
 * que se hace cada vez que se entra aquí.
 *
 * El ENUNCIADO lo escribe la empresa y se muestra tal cual, en el idioma en que lo escribió:
 * traducirlo cambiaría lo que la empresa dijo que quería.
 */
export function ObjectivesPage() {
  const t = useT();
  usePageTitle('nav.objectives');
  const formatDay = useFormatDay();
  const objectives = useResource(() =>
    api<BusinessObjective[]>('/business-objectives'),
  );
  const [creando, setCreando] = useState(false);
  const [statement, setStatement] = useState('');
  // Qué acaba de pasar, dicho con palabras. Un botón que deja de existir en silencio hace
  // dudar de si la acción llegó a ocurrir.
  const [aviso, setAviso] = useState<string | null>(null);
  const create = useAction();
  const decide = useAction();

  const todos = objectives.data ?? [];
  const pendientes = todos.filter((o) => o.status === 'INFERRED');
  const activos = todos.filter((o) => o.status !== 'INFERRED');

  const decidir = (id: string, camino: 'confirm' | 'discard') =>
    void decide
      .run(() =>
        api(`/business-objectives/${id}/${camino}`, { method: 'POST' }),
      )
      .then((ok) => {
        if (!ok) return;
        setAviso(
          t(camino === 'confirm' ? 'objectives.confirmed' : 'objectives.discarded'),
        );
        objectives.reload();
      });

  return (
    <>
      <PageHeader
        title={t('nav.objectives')}
        description={t('page.objectives.subtitle')}
        actions={
          // La acción principal, y solo cuando ya hay algo: con la pantalla vacía, la
          // invitación vive dentro del estado vacío, que además explica para qué sirve.
          todos.length > 0 && !creando ? (
            <Button variant="primary" onClick={() => setCreando(true)}>
              {t('objectives.new.open')}
            </Button>
          ) : undefined
        }
      />

      {aviso && (
        <p
          role="status"
          className="mb-4 rounded-md border border-positive/25 bg-positive-soft px-4 py-2.5 t-small text-positive"
        >
          {aviso}
        </p>
      )}

      {creando && (
        <div className="mb-4">
          <Section title={t('objectives.declare.title')} description={t('objectives.declare.why')}>
            <form
              className="space-y-4"
              onSubmit={create.onSubmit(async () => {
                await api('/business-objectives', {
                  method: 'POST',
                  body: { statement },
                });
                setStatement('');
                setCreando(false);
                setAviso(t('objectives.created'));
                objectives.reload();
              })}
            >
              <Field label={t('objectives.field')}>
                <input
                  className={fieldClass}
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  placeholder={t('objectives.placeholder')}
                  autoFocus
                  required
                />
              </Field>

              <ErrorNote error={create.error} />

              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" disabled={create.busy}>
                  {t('objectives.declare')}
                </Button>
                <Button type="button" onClick={() => setCreando(false)}>
                  {t('objectives.new.cancel')}
                </Button>
              </div>
            </form>
          </Section>
        </div>
      )}

      <ErrorNote error={decide.error} />

      <DataState
        loading={objectives.loading}
        error={objectives.error}
        empty={todos.length === 0 && !creando}
        onRetry={objectives.reload}
        emptyState={
          // Dentro de una tarjeta: suelto sobre el lienzo, un estado vacío se lee como una
          // pantalla que no ha terminado de cargar, no como una pantalla que te está
          // explicando algo.
          <Section>
            <EmptyState
              title={t('objectives.empty.title')}
              action={
                <Button variant="primary" onClick={() => setCreando(true)}>
                  {t('objectives.new.open')}
                </Button>
              }
              footnote={t('objectives.empty.example')}
            >
              {t('objectives.empty.body')}
            </EmptyState>
          </Section>
        }
      >
        <div className="space-y-4">
          {/*
            Lo que espera una decisión va PRIMERO. Es lo único de esta pantalla que el
            sistema no puede resolver solo, y mezclarlo con el resto lo hacía invisible.
          */}
          {pendientes.length > 0 && (
            <Section
              title={t('objectives.pending.title')}
              description={t('objectives.pending.why')}
            >
              <ul className="space-y-3">
                {pendientes.map((objective) => (
                  <li
                    key={objective.id}
                    className="rounded-md border border-attention/30 bg-attention-soft/40 p-4"
                  >
                    <p className="t-lead text-ink">{objective.statement}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        variant="primary"
                        disabled={decide.busy}
                        onClick={() => decidir(objective.id, 'confirm')}
                      >
                        {t('objectives.confirm')}
                      </Button>
                      <Button
                        disabled={decide.busy}
                        onClick={() => decidir(objective.id, 'discard')}
                      >
                        {t('objectives.discard')}
                      </Button>
                      <span className="t-fine text-muted">
                        {t('objectives.deducedBy')} ·{' '}
                        {t('objectives.since', {
                          date: formatDay(objective.createdAt),
                        })}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {activos.length > 0 && (
            <Section
              title={t('objectives.active.title')}
              description={t('objectives.active.why')}
            >
              <ul className="divide-y divide-line">
                {activos.map((objective) => (
                  <li
                    key={objective.id}
                    className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-x-6"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="t-body text-ink">{objective.statement}</p>
                      <p className="mt-1 t-fine text-muted">
                        {objective.origin === 'MANUAL_DECLARATION'
                          ? t('objectives.declaredBy')
                          : t('objectives.deducedBy')}{' '}
                        ·{' '}
                        {t('objectives.since', {
                          date: formatDay(objective.createdAt),
                        })}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 sm:pt-0.5">
                      {objective.status === 'CONFIRMED' ? (
                        <StatusPill tone="positive">
                          {t('objectives.status.confirmed')}
                        </StatusPill>
                      ) : (
                        <StatusPill>{objective.status}</StatusPill>
                      )}
                      {/*
                        Descartar es destructivo en el sentido que importa aquí: deja de
                        contar para los análisis. Por eso es la acción más discreta de la
                        fila y va la última, no un botón rojo compitiendo con el enunciado.
                      */}
                      {objective.status === 'CONFIRMED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={decide.busy}
                          onClick={() => decidir(objective.id, 'discard')}
                        >
                          {t('objectives.discard')}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </DataState>
    </>
  );
}

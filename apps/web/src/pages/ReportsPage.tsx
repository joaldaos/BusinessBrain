import { useState } from 'react';
import { api, download } from '../api/client';
import { useAuth } from '../auth';
import {
  hasRole,
  type KnowledgeItem,
  type Report,
  type ReportRun,
  type ReportSection,
} from '../api/types';
import {
  Button,
  DataState,
  EmptyState,
  ErrorNote,
  Field,
  fieldClass,
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
 * Informes.
 *
 * ## El PDF no se guarda en ningún sitio
 *
 * Se genera cuando lo pides y se entrega. Lo que queda registrado es qué se generó, cuándo y
 * con qué evidencia — suficiente para auditarlo y reproducirlo, sin dejar comprensión
 * confidencial reposando en un almacén sin política de retención.
 *
 * ## Lo que ves depende de TU alcance
 *
 * El informe se compone con las colecciones que tienes concedidas. Dos personas pueden
 * descargar el mismo informe y recibir contenidos distintos, exactamente igual que al leer la
 * comprensión. Se dice UNA vez, arriba, y no en cada fila: repetido en cinco tarjetas dejaba
 * de leerse a la segunda.
 *
 * ## Qué cambió en la Fase 8.1
 *
 * Un informe se describía como «3 sección(es) · PDF», que no dice absolutamente nada de lo que
 * vas a encontrar dentro. Ahora se enumera qué lleva —lo comprendido, y la búsqueda concreta
 * si la tiene— en las palabras que se usaron al crearlo, y se dice cuántas veces se ha
 * generado. La acción principal de cada informe es descargarlo, que es para lo que existe.
 */
export function ReportsPage() {
  const { role } = useAuth();
  const t = useT();
  usePageTitle('nav.reports');
  const canAdmin = hasRole(role, 'ADMIN');
  const [creando, setCreando] = useState(false);

  const reports = useResource(() => api<Report[]>('/reports'));
  // Sirve para explicar por qué un informe saldría vacío, no para bloquear nada.
  const items = useResource(() => api<KnowledgeItem[]>('/knowledge-items'));

  const lista = reports.data ?? [];
  const hayConocimiento = (items.data ?? []).some(
    (item) => item.status === 'INDEXED',
  );

  const crear = canAdmin ? (
    <Button variant="primary" onClick={() => setCreando(true)}>
      {t('reports.new.open')}
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title={t('nav.reports')}
        description={t('page.reports.subtitle')}
        actions={lista.length > 0 && !creando ? crear : undefined}
      />

      {creando && (
        <div className="mb-4">
          <CreateCard
            onCancel={() => setCreando(false)}
            onCreated={() => {
              setCreando(false);
              reports.reload();
            }}
          />
        </div>
      )}

      <DataState
        loading={reports.loading}
        error={reports.error}
        empty={lista.length === 0 && !creando}
        onRetry={reports.reload}
        emptyState={
          // Dentro de su tarjeta: suelto sobre el lienzo parecía una pantalla a medio cargar.
          <Section>
            <EmptyState
              title={t('reports.empty.title')}
              action={crear}
              footnote={
                !hayConocimiento && !items.loading
                  ? t('reports.empty.needsKnowledge')
                  : !canAdmin
                    ? t('reports.empty.needsAdmin')
                    : undefined
              }
            >
              {t('reports.empty.body')}
            </EmptyState>
          </Section>
        }
      >
        <div className="space-y-4">
          {/* El aviso de alcance, una sola vez y antes de la lista: aplica a todos. */}
          <p className="rounded-md border border-line bg-sunken px-4 py-2.5 t-small text-ink-soft">
            {t('reports.scopeWarning')}
          </p>

          <ul className="space-y-4">
            {lista.map((report) => (
              <ReportRow key={report.id} report={report} />
            ))}
          </ul>
        </div>
      </DataState>
    </>
  );
}

function CreateCard({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  // El título por defecto se toma del catálogo, pero una vez escrito es texto DE LA EMPRESA:
  // viaja al informe tal cual y no se retraduce si luego cambia de idioma.
  const [title, setTitle] = useState(t('reports.new.sectionDefault'));
  const [limit, setLimit] = useState(10);
  const [query, setQuery] = useState('');
  const action = useAction();

  return (
    <Section title={t('reports.new.title')}>
      <form
        className="space-y-4"
        onSubmit={action.onSubmit(async () => {
          const sections: Record<string, unknown>[] = [
            { type: 'INSIGHTS', title, limit },
          ];
          if (query.trim()) {
            sections.push({
              type: 'KNOWLEDGE_SEARCH',
              title: t('reports.new.searchSection', { query: query.trim() }),
              query: query.trim(),
              limit,
            });
          }

          await api('/reports', {
            method: 'POST',
            body: { name, template: { sections } },
          });
          setName('');
          setQuery('');
          onCreated();
        })}
      >
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field label={t('reports.new.name')}>
            <input
              className={fieldClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('reports.new.namePlaceholder')}
              autoFocus
              required
            />
          </Field>
          <Field label={t('reports.new.limit')}>
            <input
              type="number"
              min={1}
              max={50}
              className={fieldClass}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            />
          </Field>
        </div>

        <Field label={t('reports.new.sectionTitle')}>
          <input
            className={fieldClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </Field>

        <Field
          label={t('reports.new.search')}
          hint={t('reports.new.searchHint')}
        >
          <input
            className={fieldClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('reports.new.searchPlaceholder')}
          />
        </Field>

        <ErrorNote error={action.error} />

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={action.busy}>
            {t('reports.new.submit')}
          </Button>
          <Button type="button" onClick={onCancel}>
            {t('reports.new.cancel')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

/**
 * Qué lleva dentro un informe, dicho con las palabras con las que se creó.
 *
 * Los títulos de sección los escribió la empresa: se muestran tal cual. Lo que se traduce es
 * la frase que los envuelve.
 */
function describirSeccion(
  seccion: ReportSection,
  t: ReturnType<typeof useT>,
): string {
  if (seccion.type === 'KNOWLEDGE_SEARCH' && seccion.query) {
    return t('reports.section.search', { query: seccion.query });
  }
  return t('reports.section.insights', { limit: seccion.limit ?? 10 });
}

function ReportRow({ report }: { report: Report }) {
  const t = useT();
  const labels = useLabels();
  const formatDate = useFormatDate();
  const [open, setOpen] = useState(false);
  const action = useAction();
  const runs = useResource(
    () =>
      open
        ? api<ReportRun[]>(`/reports/${report.id}/runs`)
        : Promise.resolve([]),
    [open, report.id],
  );

  /**
   * Descarga el PDF.
   *
   * El navegador no puede seguir un `POST` como navegación, así que se pide con `fetch` y se
   * entrega desde memoria. La URL temporal se revoca en cuanto se usa: dejarla viva mantendría
   * el documento accesible en la pestaña más tiempo del necesario.
   */
  const generate = () =>
    action.run(async () => {
      const { blob, fileName } = await download(
        `/reports/${report.id}/generate`,
        { method: 'POST' },
      );

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);

      if (open) runs.reload();
    });

  const veces = report._count?.runs ?? 0;
  const secciones = report.template?.sections ?? [];

  return (
    <li>
      <Section title={report.name}>
        <p className="t-micro text-muted">{t('reports.contains')}</p>
        <ul className="mt-1.5 space-y-1">
          {secciones.map((seccion, indice) => (
            <li key={indice} className="t-body text-ink-soft">
              {describirSeccion(seccion, t)}
            </li>
          ))}
        </ul>

        <p className="mt-3 t-fine text-muted">
          {veces === 0
            ? t('reports.neverGenerated')
            : t('reports.generatedTimes', { count: veces })}
        </p>

        <ErrorNote error={action.error} />

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button
            variant="primary"
            disabled={action.busy}
            onClick={() => void generate()}
          >
            {action.busy ? t('reports.downloading') : t('reports.download')}
          </Button>
          <Button
            variant="ghost"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? t('reports.runs.hide') : t('reports.runs')}
          </Button>
        </div>

        {open && (
          <div className="mt-4 border-t border-line pt-4">
            <DataState
              loading={runs.loading}
              error={runs.error}
              empty={(runs.data?.length ?? 0) === 0}
              emptyMessage={t('reports.runs.empty')}
              skeleton={2}
            >
              <ul className="space-y-1.5">
                {runs.data?.map((run) => (
                  <li
                    key={run.id}
                    className="flex flex-wrap items-center gap-2 t-fine"
                  >
                    <StatusPill
                      tone={run.status === 'SUCCESS' ? 'positive' : 'danger'}
                    >
                      {labels.runStatus(run.status)}
                    </StatusPill>
                    <span className="text-muted">
                      {formatDate(run.generatedAt)}
                    </span>
                    <span className="text-faint">{t('reports.notStored')}</span>
                    {run.error && (
                      <span className="text-danger">{run.error}</span>
                    )}
                  </li>
                ))}
              </ul>
            </DataState>
          </div>
        )}
      </Section>
    </li>
  );
}

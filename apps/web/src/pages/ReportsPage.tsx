import { useState } from 'react';
import { api, download } from '../api/client';
import { useAuth } from '../auth';
import { hasRole, type Report, type ReportRun } from '../api/types';
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
 * comprensión. La interfaz lo dice en voz alta para que nadie lo interprete como un fallo.
 */
export function ReportsPage() {
  const { role } = useAuth();
  const t = useT();
  const canAdmin = hasRole(role, 'ADMIN');
  const reports = useResource(() => api<Report[]>('/reports'));

  return (
    <>
      {canAdmin && <CreateCard onCreated={reports.reload} />}

      <Card title={t('reports.title', { count: reports.data?.length ?? 0 })}>
        <ErrorNote error={reports.error} />
        {reports.loading && <Empty>{t('common.loading')}</Empty>}
        {!reports.loading && (reports.data?.length ?? 0) === 0 && (
          <Empty>{t('reports.empty')}</Empty>
        )}

        <ul className="space-y-3">
          {reports.data?.map((report) => (
            <ReportRow key={report.id} report={report} />
          ))}
        </ul>
      </Card>
    </>
  );
}

function CreateCard({ onCreated }: { onCreated: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  // El título por defecto se toma del catálogo, pero una vez escrito es texto DE LA EMPRESA:
  // viaja al informe tal cual y no se retraduce si luego cambia de idioma.
  const [title, setTitle] = useState(t('reports.new.sectionDefault'));
  const [limit, setLimit] = useState(10);
  const [query, setQuery] = useState('');
  const action = useAction();

  return (
    <Card title={t('reports.new.title')}>
      <form
        className="space-y-3"
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
        <div className="flex flex-wrap gap-2">
          <div className="min-w-56 flex-1">
            <Field label={t('reports.new.name')}>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('reports.new.namePlaceholder')}
                required
              />
            </Field>
          </div>
          <div className="min-w-24">
            <Field label={t('reports.new.limit')}>
              <input
                type="number"
                min={1}
                max={50}
                className={inputClass}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              />
            </Field>
          </div>
        </div>

        <Field label={t('reports.new.sectionTitle')}>
          <input
            className={inputClass}
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
            className={inputClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('reports.new.searchPlaceholder')}
          />
        </Field>

        <ErrorNote error={action.error} />
        <Button type="submit" disabled={action.busy}>
          {t('reports.new.submit')}
        </Button>
      </form>
    </Card>
  );
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

  return (
    <li className="rounded border border-gray-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{report.name}</span>
        <span className="text-xs text-gray-500">
          {t('reports.sections', {
            count: report.template?.sections?.length ?? 0,
          })}{' '}
          · {report.format}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={() => setOpen(!open)}>
            {open ? t('reports.runs.hide') : t('reports.runs')}
          </Button>
          <Button disabled={action.busy} onClick={() => void generate()}>
            {action.busy ? t('reports.downloading') : t('reports.download')}
          </Button>
        </div>
      </div>

      <p className="mt-1 text-xs text-gray-500">{t('reports.scopeWarning')}</p>

      <ErrorNote error={action.error} />

      {open && (
        <div className="mt-3 border-t border-gray-100 pt-2">
          {runs.loading && <Empty>{t('common.loading')}</Empty>}
          {!runs.loading && (runs.data?.length ?? 0) === 0 && (
            <Empty>{t('reports.runs.empty')}</Empty>
          )}
          <ul className="space-y-1 text-xs">
            {runs.data?.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={run.status === 'SUCCESS' ? 'good' : 'bad'}>
                  {labels.runStatus(run.status)}
                </Badge>
                <span className="text-gray-500">
                  {formatDate(run.generatedAt)}
                </span>
                <span className="text-gray-400">{t('reports.notStored')}</span>
                {run.error && <span className="text-red-700">{run.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

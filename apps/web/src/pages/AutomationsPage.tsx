import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import {
  hasRole,
  type Automation,
  type AutomationRun,
  type KnowledgeSource,
  type Report,
} from '../api/types';
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
import { useT, type TranslationKey } from '../i18n';
import { useLabels } from '../i18n/labels';

/**
 * Horarios habituales, como CLAVES.
 *
 * Cron a mano es una fuente de errores que nadie descubre hasta tarde, así que se ofrecen unos
 * pocos ya escritos. La expresión es técnica y no cambia; lo que se lee, sí.
 */
const SCHEDULES: { label: TranslationKey; cron: string }[] = [
  { label: 'automations.schedule.mondays', cron: '0 8 * * 1' },
  { label: 'automations.schedule.daily', cron: '0 7 * * *' },
  { label: 'automations.schedule.monthly', cron: '0 8 1 * *' },
  { label: 'automations.schedule.every6h', cron: '0 */6 * * *' },
];

/**
 * Automatizaciones: que el sistema trabaje sin nadie delante.
 *
 * Solo se ofrecen las acciones del catálogo cerrado del backend. La interfaz **no permite
 * escribir un plan libre** a propósito: si aceptara JSON arbitrario, el usuario podría
 * componer algo que la API rechaza, y peor aún, daría a entender que se puede automatizar
 * cualquier cosa. Una automatización solo orquesta capacidades internas que ya existen.
 */
export function AutomationsPage() {
  const { role } = useAuth();
  const t = useT();
  const canAdmin = hasRole(role, 'ADMIN');

  const automations = useResource(() => api<Automation[]>('/automations'));
  const reports = useResource(() => api<Report[]>('/reports'));
  const sources = useResource(() => api<KnowledgeSource[]>('/knowledge-sources'));

  // Solo las fuentes que van a BUSCAR su contenido pueden programarse. Una de subida manual
  // dejaría una automatización fallando cada semana esperando un archivo que nadie sube.
  const syncable = (sources.data ?? []).filter(
    (source) => source.type === 'WEBSITE',
  );

  return (
    <>
      {canAdmin && (
        <CreateCard
          reports={reports.data ?? []}
          sources={syncable}
          onCreated={automations.reload}
        />
      )}

      <Card
        title={t('automations.title', {
          count: automations.data?.length ?? 0,
        })}
      >
        <ErrorNote error={automations.error} />
        {automations.loading && <Empty>{t('common.loading')}</Empty>}
        {!automations.loading && (automations.data?.length ?? 0) === 0 && (
          <Empty>{t('automations.empty')}</Empty>
        )}

        <ul className="space-y-3">
          {automations.data?.map((automation) => (
            <AutomationRow
              key={automation.id}
              automation={automation}
              canAdmin={canAdmin}
              onChanged={automations.reload}
            />
          ))}
        </ul>
      </Card>
    </>
  );
}

function CreateCard({
  reports,
  sources,
  onCreated,
}: {
  reports: Report[];
  sources: KnowledgeSource[];
  onCreated: () => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [cron, setCron] = useState(SCHEDULES[0].cron);
  const [sourceId, setSourceId] = useState('');
  const [analyze, setAnalyze] = useState(true);
  const [reportId, setReportId] = useState('');
  const action = useAction();

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <Card title={t('automations.new.title')}>
      <form
        className="space-y-3"
        onSubmit={action.onSubmit(async () => {
          const actions: {
            type: string;
            reportId?: string;
            knowledgeSourceId?: string;
          }[] = [];
          // El orden importa: primero entra el conocimiento, después se comprende y por
          // último se informa. Al revés, el informe hablaría de lo de la semana pasada.
          if (sourceId) {
            actions.push({
              type: 'SYNC_KNOWLEDGE_SOURCE',
              knowledgeSourceId: sourceId,
            });
          }
          if (analyze) actions.push({ type: 'RUN_ANALYSIS' });
          if (reportId) actions.push({ type: 'GENERATE_REPORT', reportId });

          await api('/automations', {
            method: 'POST',
            body: {
              name,
              triggerType: 'SCHEDULE',
              triggerConfig: { cron, timezone },
              actions,
            },
          });
          setName('');
          setReportId('');
          setSourceId('');
          onCreated();
        })}
      >
        <div className="flex flex-wrap gap-2">
          <div className="min-w-56 flex-1">
            <Field label={t('automations.new.name')}>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('automations.new.namePlaceholder')}
                required
              />
            </Field>
          </div>
          <div className="min-w-56">
            <Field
              label={t('automations.new.when')}
              hint={t('automations.new.timezone', { timezone })}
            >
              <select
                className={inputClass}
                value={cron}
                onChange={(e) => setCron(e.target.value)}
              >
                {SCHEDULES.map((schedule) => (
                  <option key={schedule.cron} value={schedule.cron}>
                    {t(schedule.label)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-gray-700">
            {t('automations.new.whatItDoes')}
          </legend>
          {sources.length > 0 && (
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span>{t('automations.new.reread')}</span>
              <select
                aria-label={t('automations.new.sourceLabel')}
                className={`${inputClass} max-w-64`}
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              >
                <option value="">{t('automations.new.noSource')}</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={analyze}
              onChange={(e) => setAnalyze(e.target.checked)}
            />
            {t('automations.new.analyze')}
          </label>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t('automations.new.andReport')}</span>
            <select
              className={`${inputClass} max-w-64`}
              value={reportId}
              onChange={(e) => setReportId(e.target.value)}
            >
              <option value="">{t('automations.new.noReport')}</option>
              {reports.map((report) => (
                <option key={report.id} value={report.id}>
                  {report.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-gray-500">
            {t('automations.new.governance')}
          </p>
        </fieldset>

        <ErrorNote error={action.error} />
        <Button
          type="submit"
          disabled={action.busy || (!analyze && !reportId && !sourceId)}
        >
          {t('common.create')}
        </Button>
      </form>
    </Card>
  );
}

function AutomationRow({
  automation,
  canAdmin,
  onChanged,
}: {
  automation: Automation;
  canAdmin: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const labels = useLabels();
  const formatDate = useFormatDate();
  const [open, setOpen] = useState(false);
  const action = useAction();
  const runs = useResource(
    () =>
      open
        ? api<AutomationRun[]>(`/automations/${automation.id}/runs`)
        : Promise.resolve([]),
    [open, automation.id],
  );

  const tone =
    automation.status === 'ACTIVE'
      ? 'good'
      : automation.status === 'ERROR'
        ? 'bad'
        : 'neutral';

  /** `RUN_ANALYSIS` no le dice nada a nadie. Un tipo desconocido se muestra tal cual. */
  const describeAction = (type: string) => {
    const clave = `automations.action.${type}` as TranslationKey;
    const texto = t(clave);
    return texto === clave ? type : texto;
  };

  return (
    <li className="rounded border border-gray-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{automation.name}</span>
        <Badge tone={tone}>{labels.automationStatus(automation.status)}</Badge>
        <span className="text-xs text-gray-500">
          {automation.actions.map((a) => describeAction(a.type)).join(' → ')}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={() => setOpen(!open)}>
            {open ? t('automations.runs.hide') : t('automations.runs')}
          </Button>
          {canAdmin && (
            <>
              <Button
                disabled={action.busy}
                onClick={() =>
                  void action
                    .run(() =>
                      api(`/automations/${automation.id}/run`, {
                        method: 'POST',
                      }),
                    )
                    .then(() => {
                      onChanged();
                      runs.reload();
                    })
                }
              >
                {t('automations.runNow')}
              </Button>
              <Button
                variant="secondary"
                disabled={action.busy}
                onClick={() =>
                  void action
                    .run(() =>
                      api(`/automations/${automation.id}`, {
                        method: 'PATCH',
                        body: {
                          status:
                            automation.status === 'ACTIVE'
                              ? 'PAUSED'
                              : 'ACTIVE',
                        },
                      }),
                    )
                    .then(onChanged)
                }
              >
                {automation.status === 'ACTIVE'
                  ? t('automations.pause')
                  : t('automations.resume')}
              </Button>
            </>
          )}
        </div>
      </div>

      <p className="mt-1 text-xs text-gray-500">
        {automation.triggerConfig.cron
          ? t('automations.scheduled', {
              cron: automation.triggerConfig.cron,
              timezone: automation.triggerConfig.timezone ?? '',
            })
          : t('automations.manual')}{' '}
        · {t('automations.lastRun', { date: formatDate(automation.lastRunAt) })}{' '}
        · {t('automations.nextRun', { date: formatDate(automation.nextRunAt) })}
      </p>

      <ErrorNote error={action.error} />

      {open && (
        <div className="mt-3 border-t border-gray-100 pt-2">
          {runs.loading && <Empty>{t('common.loading')}</Empty>}
          {!runs.loading && (runs.data?.length ?? 0) === 0 && (
            <Empty>{t('automations.runs.empty')}</Empty>
          )}
          <ul className="space-y-2">
            {runs.data?.map((run) => (
              <li key={run.id} className="text-xs">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={run.status === 'SUCCESS' ? 'good' : 'bad'}>
                    {labels.runStatus(run.status)}
                  </Badge>
                  <span className="text-gray-500">
                    {formatDate(run.startedAt)}
                  </span>
                </span>
                <ul className="mt-1 space-y-0.5 pl-2 text-gray-600">
                  {run.logs?.map((log, index) => (
                    <li key={index}>
                      {describeAction(log.action)}: {log.detail}
                    </li>
                  ))}
                </ul>
                {run.error && <p className="text-red-700">{run.error}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

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
 *
 * ## Qué cambió en la Fase 8.1
 *
 * La pantalla abría con el formulario de crear —seis campos— y debajo una lista donde cada
 * automatización se resumía en una línea con `0 8 * * 1` escrito tal cual. Un dueño de
 * panadería no tiene por qué saber leer una expresión de cron, y ese texto era literalmente
 * la única indicación de cuándo iba a pasar algo.
 *
 * Ahora cada automatización dice en castellano qué hace, cuándo lo vuelve a hacer y cómo le
 * fue la última vez. El formulario está detrás de la acción de cabecera: crear una es algo
 * que se hace una vez, no cada vez que se entra.
 */
export function AutomationsPage() {
  const { role } = useAuth();
  const t = useT();
  usePageTitle('nav.automations');
  const canAdmin = hasRole(role, 'ADMIN');
  const [creando, setCreando] = useState(false);

  const automations = useResource(() => api<Automation[]>('/automations'));
  const reports = useResource(() => api<Report[]>('/reports'));
  const sources = useResource(() => api<KnowledgeSource[]>('/knowledge-sources'));

  // Solo las fuentes que van a BUSCAR su contenido pueden programarse. Una de subida manual
  // dejaría una automatización fallando cada semana esperando un archivo que nadie sube.
  const syncable = (sources.data ?? []).filter(
    (source) => source.type === 'WEBSITE',
  );

  const lista = automations.data ?? [];

  const crear = canAdmin ? (
    <Button variant="primary" onClick={() => setCreando(true)}>
      {t('automations.new.open')}
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title={t('nav.automations')}
        description={t('page.automations.subtitle')}
        actions={lista.length > 0 && !creando ? crear : undefined}
      />

      {creando && (
        <div className="mb-4">
          <CreateCard
            reports={reports.data ?? []}
            sources={syncable}
            onCancel={() => setCreando(false)}
            onCreated={() => {
              setCreando(false);
              automations.reload();
            }}
          />
        </div>
      )}

      <DataState
        loading={automations.loading}
        error={automations.error}
        empty={lista.length === 0 && !creando}
        onRetry={automations.reload}
        emptyState={
          <Section>
            <EmptyState
              title={t('automations.empty.title')}
              action={crear}
              footnote={canAdmin ? undefined : t('automations.empty.needsAdmin')}
            >
              {t('automations.empty.body')}
            </EmptyState>
          </Section>
        }
      >
        <ul className="space-y-4">
          {lista.map((automation) => (
            <AutomationRow
              key={automation.id}
              automation={automation}
              canAdmin={canAdmin}
              onChanged={automations.reload}
            />
          ))}
        </ul>
      </DataState>
    </>
  );
}

function CreateCard({
  reports,
  sources,
  onCancel,
  onCreated,
}: {
  reports: Report[];
  sources: KnowledgeSource[];
  onCancel: () => void;
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
    <Section
      title={t('automations.new.title')}
      description={t('automations.new.governance')}
    >
      <form
        className="space-y-4"
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('automations.new.name')}>
            <input
              className={fieldClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('automations.new.namePlaceholder')}
              autoFocus
              required
            />
          </Field>
          <Field
            label={t('automations.new.when')}
            hint={t('automations.new.timezone', { timezone })}
          >
            <select
              className={fieldClass}
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

        <fieldset className="space-y-2.5 rounded-md bg-sunken p-4">
          <legend className="t-micro text-muted">
            {t('automations.new.whatItDoes')}
          </legend>
          {sources.length > 0 && (
            <label className="flex flex-wrap items-center gap-2 t-small text-ink-soft">
              <span>{t('automations.new.reread')}</span>
              <select
                aria-label={t('automations.new.sourceLabel')}
                className={`${fieldClass} max-w-64`}
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
          <label className="flex items-center gap-2 t-small text-ink-soft">
            <input
              type="checkbox"
              className="h-4 w-4 accent-accent"
              checked={analyze}
              onChange={(e) => setAnalyze(e.target.checked)}
            />
            {t('automations.new.analyze')}
          </label>
          <label className="flex flex-wrap items-center gap-2 t-small text-ink-soft">
            <span>{t('automations.new.andReport')}</span>
            <select
              className={`${fieldClass} max-w-64`}
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
        </fieldset>

        <ErrorNote error={action.error} />

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={action.busy || (!analyze && !reportId && !sourceId)}
          >
            {t('automations.new.submit')}
          </Button>
          <Button type="button" onClick={onCancel}>
            {t('automations.new.cancel')}
          </Button>
        </div>
      </form>
    </Section>
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
      ? 'positive'
      : automation.status === 'ERROR'
        ? 'danger'
        : 'neutral';

  /** `RUN_ANALYSIS` no le dice nada a nadie. Un tipo desconocido se muestra tal cual. */
  const describeAction = (type: string) => {
    const clave = `automations.action.${type}` as TranslationKey;
    const texto = t(clave);
    return texto === clave ? type : texto;
  };

  /**
   * Cuándo se ejecuta, en castellano.
   *
   * `0 8 * * 1` es la expresión que entiende el planificador, no una frase. Se busca en los
   * horarios que ofrece la propia pantalla; solo si alguien creó la automatización por API
   * con un horario que no está en la lista se enseña la expresión, porque decir "programada"
   * a secas sería peor que decir algo técnico.
   */
  const cuando = () => {
    const cron = automation.triggerConfig.cron;
    if (!cron) return t('automations.manual');
    const conocido = SCHEDULES.find((schedule) => schedule.cron === cron);
    return conocido
      ? t(conocido.label)
      : t('automations.scheduled', {
          cron,
          timezone: automation.triggerConfig.timezone ?? '',
        });
  };

  const veces = automation._count?.runs ?? 0;

  return (
    <li>
      <Section
        title={automation.name}
        actions={
          <StatusPill tone={tone}>
            {labels.automationStatus(automation.status)}
          </StatusPill>
        }
      >
        {/*
          Qué hace y cuándo, como dos hechos legibles. Antes era una línea con el estado, la
          cadena de acciones, la expresión de cron, la última ejecución y la próxima, todo
          seguido y separado por puntos medios.
        */}
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="t-micro text-muted">{t('automations.does')}</dt>
            <dd className="mt-1 t-body text-ink">
              {automation.actions.map((a) => describeAction(a.type)).join(', ')}
            </dd>
          </div>
          <div>
            <dt className="t-micro text-muted">{t('automations.next')}</dt>
            <dd className="mt-1 t-body text-ink">
              {cuando()}
              {automation.nextRunAt && (
                <span className="text-muted">
                  {' · '}
                  {formatDate(automation.nextRunAt)}
                </span>
              )}
            </dd>
          </div>
        </dl>

        <p className="mt-3 t-fine text-muted">
          {veces === 0
            ? t('automations.never')
            : `${t('automations.ranTimes', { count: veces })} · ${t(
                'automations.lastResultAt',
                { date: formatDate(automation.lastRunAt) },
              )}`}
        </p>

        {automation.status === 'PAUSED' && (
          <p className="mt-3 rounded-md bg-sunken px-3 py-2 t-small text-ink-soft">
            {t('automations.paused.hint')}
          </p>
        )}
        {automation.status === 'ERROR' && (
          <p className="mt-3 rounded-md border border-danger/25 bg-danger-soft px-3 py-2 t-small text-danger">
            {t('automations.error.hint')}
          </p>
        )}

        <ErrorNote error={action.error} />

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
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
                      setOpen(true);
                    })
                }
              >
                {t('automations.runNow')}
              </Button>
              <Button
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
          <Button
            variant="ghost"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? t('automations.runs.hide') : t('automations.runs')}
          </Button>
        </div>

        {open && (
          <div className="mt-4 border-t border-line pt-4">
            <DataState
              loading={runs.loading}
              error={runs.error}
              empty={(runs.data?.length ?? 0) === 0}
              emptyMessage={t('automations.runs.empty')}
              skeleton={2}
            >
              <ul className="space-y-3">
                {runs.data?.map((run) => (
                  <li key={run.id}>
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusPill
                        tone={run.status === 'SUCCESS' ? 'positive' : 'danger'}
                      >
                        {labels.runStatus(run.status)}
                      </StatusPill>
                      <span className="t-fine text-muted">
                        {formatDate(run.startedAt)}
                      </span>
                    </span>
                    <ul className="mt-1.5 space-y-0.5 t-fine text-muted">
                      {run.logs?.map((log, index) => (
                        <li key={index}>
                          {describeAction(log.action)}: {log.detail}
                        </li>
                      ))}
                    </ul>
                    {run.error && (
                      <p className="mt-1 t-fine text-danger">{run.error}</p>
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

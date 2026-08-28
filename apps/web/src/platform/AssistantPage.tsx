import { useCallback, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { useResource } from '../components/ui';
import { useT, type TranslationKey } from '../i18n';
import {
  ActionButton,
  DataState,
  PageHeader,
  Section,
  StatusPill,
} from './ui';
import type { MyGrant } from './types';

interface Capability {
  name: string;
  purpose: string;
  /** Código estable del alcance que hace falta, o `null`. La interfaz lo traduce. */
  requires: 'METADATA' | 'DIAGNOSTICS' | 'CONTENT' | null;
}

interface Answer {
  text: string;
  consulted: Array<{ tool: string; outcome: string }>;
}

interface Exchange {
  question: string;
  answer: Answer | null;
  failed: boolean;
}

/**
 * El asistente de operación.
 *
 * ## Por qué esto no es un chat vacío
 *
 * Un cuadro de texto en blanco le traslada a quien pregunta el trabajo de adivinar qué puede
 * preguntar — y con un asistente acotado a seis consultas, adivinar significa chocarse con los
 * límites una y otra vez. Antes de escribir nada se ve: **qué puede consultar**, **qué accesos
 * tiene abiertos ahora mismo** y **tres preguntas que funcionan**.
 *
 * ## Y por qué se enseña lo que consultó
 *
 * Debajo de cada respuesta va la lista de lo que el asistente miró y cómo le fue. Es lo que
 * convierte una respuesta en algo comprobable: se ve de dónde salió, y se ve cuándo NO
 * consultó nada — que es justo el caso en el que una respuesta segura de sí misma sería una
 * invención.
 *
 * Cuando algo se denegó por falta de acceso, no se enseña un error: se enseña qué acceso falta
 * y desde dónde se pide.
 */
export function PlatformAssistantPage() {
  const t = useT();
  const { user } = useAuth();
  const [question, setQuestion] = useState('');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);

  const capabilities = useResource<Capability[]>(
    useCallback(
      () =>
        api<Capability[]>('/platform/assistant/capabilities', {
          withoutOrganization: true,
        }),
      [],
    ),
  );

  const grants = useResource<MyGrant[]>(
    useCallback(
      () => api<MyGrant[]>('/platform/access', { withoutOrganization: true }),
      [],
    ),
  );

  const abiertos = (grants.data ?? []).filter((grant) => grant.usable);

  const preguntar = async (texto: string) => {
    const limpio = texto.trim();
    if (limpio.length < 2 || busy) return;

    setQuestion('');
    setBusy(true);
    const indice = exchanges.length;
    setExchanges((previos) => [
      ...previos,
      { question: limpio, answer: null, failed: false },
    ]);

    try {
      const answer = await api<Answer>('/platform/assistant/ask', {
        method: 'POST',
        withoutOrganization: true,
        body: { question: limpio },
      });
      setExchanges((previos) =>
        previos.map((e, i) => (i === indice ? { ...e, answer } : e)),
      );
    } catch {
      // El mensaje del backend NO se enseña: está en un idioma fijo y escrito para quien lee
      // un registro. Lo que se dice es qué pasó y qué hacer.
      setExchanges((previos) =>
        previos.map((e, i) => (i === indice ? { ...e, failed: true } : e)),
      );
    } finally {
      setBusy(false);
      campo.current?.focus();
    }
  };

  const ejemplos: TranslationKey[] = [
    'platform.assistant.example.health',
    'platform.assistant.example.quiet',
    'platform.assistant.example.recent',
  ];

  return (
    <>
      <PageHeader
        title={t('platform.assistant.title')}
        description={t('platform.assistant.subtitle')}
      />

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* ── La conversación ────────────────────────────────────────────── */}
        <div className="space-y-4">
          {exchanges.length === 0 ? (
            <Section title={t('platform.assistant.startHere')}>
              <p className="mb-4 text-[13px] leading-relaxed text-muted">
                {t('platform.assistant.startHint')}
              </p>
              <ul className="space-y-2">
                {ejemplos.map((clave) => (
                  <li key={clave}>
                    <button
                      type="button"
                      onClick={() => void preguntar(t(clave))}
                      className="w-full rounded border border-line px-3 py-2 text-left text-[13px] transition hover:border-gray-400"
                    >
                      {t(clave)}
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          ) : (
            <ol className="space-y-4">
              {exchanges.map((exchange, indice) => (
                <li key={indice}>
                  <Section>
                    <p className="mb-3 border-l-2 border-line pl-3 text-[13.5px] font-medium">
                      {exchange.question}
                    </p>

                    {exchange.failed ? (
                      <p role="alert" className="text-[13px] text-red-700">
                        {t('platform.assistant.failed')}
                      </p>
                    ) : exchange.answer ? (
                      <>
                        {/*
                          `whitespace-pre-wrap`: el asistente estructura su respuesta con
                          saltos de línea, y colapsarlos la convertiría en un párrafo denso.
                        */}
                        <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">
                          {exchange.answer.text}
                        </p>
                        <Consulted consulted={exchange.answer.consulted} />
                      </>
                    ) : (
                      <p
                        role="status"
                        aria-live="polite"
                        className="text-[13px] text-muted"
                      >
                        {t('platform.assistant.thinking')}
                      </p>
                    )}
                  </Section>
                </li>
              ))}
            </ol>
          )}

          <Section>
            <label htmlFor="pregunta" className="sr-only">
              {t('platform.assistant.ask')}
            </label>
            <textarea
              id="pregunta"
              ref={campo}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                // Enter envía, Mayús+Enter salta de línea: lo que espera cualquiera.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void preguntar(question);
                }
              }}
              rows={3}
              placeholder={t('platform.assistant.placeholder')}
              className="w-full rounded border border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-gray-500"
            />
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[11.5px] text-muted">
                {t('platform.assistant.neverExecutes')}
              </p>
              <ActionButton
                variant="primary"
                onClick={() => void preguntar(question)}
                disabled={busy || question.trim().length < 2}
              >
                {busy ? t('common.moment') : t('platform.assistant.ask')}
              </ActionButton>
            </div>
          </Section>
        </div>

        {/* ── El contexto: qué puede, y con qué permisos ──────────────────── */}
        <aside className="space-y-4">
          <Section
            title={t('platform.assistant.currentAccess')}
            description={t('platform.assistant.currentAccessHint')}
          >
            <DataState
              loading={grants.loading}
              error={grants.error}
              empty={abiertos.length === 0}
              emptyMessage={t('platform.assistant.noAccess')}
              onRetry={grants.reload}
            >
              <ul className="space-y-2">
                {abiertos.map((grant) => (
                  <li
                    key={grant.id}
                    className="flex flex-wrap items-center gap-2 text-[13px]"
                  >
                    <StatusPill tone="active">
                      {t(`platform.scope.${grant.scope}.name`)}
                    </StatusPill>
                    <span>{grant.organization.name}</span>
                  </li>
                ))}
              </ul>
            </DataState>
          </Section>

          <Section title={t('platform.assistant.canConsult')}>
            <DataState
              loading={capabilities.loading}
              error={capabilities.error}
              onRetry={capabilities.reload}
            >
              <ul className="space-y-3">
                {(capabilities.data ?? []).map((capability) => (
                  <li key={capability.name}>
                    <p className="text-[13px] leading-relaxed">
                      {capability.purpose}
                    </p>
                    {capability.requires && (
                      <p className="mt-0.5 text-[11.5px] text-muted">
                        {t('platform.assistant.needsScope', {
                          scope: t(
                            `platform.scope.${capability.requires}.name`,
                          ),
                        })}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </DataState>
          </Section>

          <Section title={t('platform.assistant.cannot')}>
            <p className="text-[13px] leading-relaxed text-muted">
              {t('platform.assistant.cannotHint')}
            </p>
          </Section>

          {user && (
            <p className="px-1 text-[11.5px] text-muted">
              {t('platform.assistant.asWho', { who: user.name })}
            </p>
          )}
        </aside>
      </div>
    </>
  );
}

/**
 * Lo que el asistente consultó, debajo de su respuesta.
 *
 * Es lo que hace la respuesta comprobable. Cuando la lista está vacía se dice explícitamente:
 * una respuesta sin consultas es una respuesta sin datos detrás, y eso hay que verlo.
 */
function Consulted({
  consulted,
}: {
  consulted: Array<{ tool: string; outcome: string }>;
}) {
  const t = useT();

  if (consulted.length === 0) {
    return (
      <p className="mt-3 border-t border-line pt-2 text-[11.5px] text-muted">
        {t('platform.assistant.consultedNothing')}
      </p>
    );
  }

  return (
    <div className="mt-3 border-t border-line pt-2">
      <p className="text-[11.5px] uppercase tracking-[0.06em] text-muted">
        {t('platform.assistant.consulted')}
      </p>
      <ul className="mt-1 space-y-1">
        {consulted.map((item, indice) => (
          <li key={indice} className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-ink/80">
              {toolLabel(t, item.tool)}
            </span>
            {item.outcome === 'NEEDS_GRANT' && (
              <StatusPill tone="attention">
                {t('platform.assistant.outcome.NEEDS_GRANT')}
              </StatusPill>
            )}
            {item.outcome === 'UNKNOWN_TOOL' && (
              <StatusPill tone="quiet">
                {t('platform.assistant.outcome.UNKNOWN_TOOL')}
              </StatusPill>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * El nombre de una herramienta, dicho para una persona.
 *
 * Si el backend añade una y nadie la traduce, se enseña su nombre técnico: feo, visible y
 * arreglable. Lo que no puede aparecer es una clave de traducción, que no le dice nada a nadie.
 */
function toolLabel(t: ReturnType<typeof useT>, tool: string): string {
  const clave = `platform.assistant.tool.${tool}` as TranslationKey;
  const texto = t(clave);
  return texto === clave ? tool : texto;
}

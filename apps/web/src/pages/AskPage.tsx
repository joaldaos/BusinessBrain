import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type {
  Conversation,
  ConversationMessage,
  KnowledgeItem,
  MessageCitation,
  SentMessage,
} from '../api/types';
import {
  Button,
  ErrorNote,
  PageHeader,
  Section,
  StatusPill,
  fieldClass,
  useAction,
  useFormatDate,
  usePageTitle,
  useResource,
} from '../components/ui';
import { useT, type TranslationKey } from '../i18n';
import { useLabels } from '../i18n/labels';

/**
 * Preguntarle a la empresa.
 *
 * ## Por qué esta pantalla es el producto
 *
 * Todo lo demás —conectar fuentes, versionar, clasificar, analizar— es infraestructura que una
 * PYME no puede evaluar. Esto sí: se escribe una pregunta en su idioma y se obtiene una
 * respuesta **con las fuentes de las que sale**. Es la diferencia entre "tengo un sistema" y
 * "esto me sirve".
 *
 * ## Y por eso, desde la Fase 8, se ve como el producto
 *
 * Antes esto era una tarjeta más, del mismo tamaño y del mismo peso visual que la lista de
 * conversaciones que tenía al lado. La función que justifica todo el sistema entraba con un
 * campo de texto de una línea perdido debajo de un hilo vacío, y los ejemplos de pregunta eran
 * viñetas grises que nadie podía pulsar.
 *
 * Ahora, cuando no hay conversación, la pantalla ES el cuadro de pregunta: el campo ocupa el
 * ancho, tiene tamaño de titular y los ejemplos son botones de verdad que preguntan al pulsar.
 * Alguien que entra por primera vez no tiene que descubrir nada.
 *
 * ## Las citas no son decoración
 *
 * Una respuesta sin fuentes es indistinguible de una invención, y en una empresa eso no vale
 * para tomar ninguna decisión. Por eso cada respuesta muestra de qué documentos salió, con
 * enlace al documento real, y por eso se muestra también la comprensión que se usó: quien lee
 * tiene que poder ir a comprobarlo.
 *
 * Cuando no hay material, BusinessBrain lo dice en vez de rellenar. Esta pantalla no lo
 * disimula: si la respuesta llega sin citas, se señala explícitamente.
 *
 * ## El idioma de la respuesta y el de los documentos son cosas distintas
 *
 * Se responde en el idioma de quien pregunta. Los TÍTULOS de las fuentes, en cambio, se
 * muestran tal y como están en el documento: una factura en inglés se cita en inglés, porque
 * quien lee la respuesta tiene que poder ir al documento y encontrarlo con ese nombre.
 * Traducir una cita la convierte en algo que no existe.
 *
 * ## El alcance es de la PERSONA
 *
 * La conversación se crea sin agente, y ese camino prepara el turno con las colecciones
 * concedidas a quien pregunta. Dos personas de la misma empresa pueden hacer la misma pregunta
 * y recibir respuestas distintas, y eso es correcto: cada una ve lo que tiene concedido.
 */
export function AskPage() {
  const t = useT();
  usePageTitle('nav.ask');
  const conversations = useResource(() => api<Conversation[]>('/conversations'));
  const [activeId, setActiveId] = useState<string | null>(null);

  // Al entrar se retoma la última conversación en vez de abrir una vacía: lo normal es
  // continuar preguntando, no empezar de cero.
  useEffect(() => {
    if (!activeId && conversations.data && conversations.data.length > 0) {
      setActiveId(conversations.data[0].id);
    }
  }, [activeId, conversations.data]);

  return (
    <>
      <PageHeader title={t('ask.title')} description={t('ask.subtitle')} />

      <div className="grid gap-6 lg:grid-cols-[1fr_15rem] lg:items-start">
        <Thread
          key={activeId ?? 'nueva'}
          conversationId={activeId}
          onStarted={(id) => {
            setActiveId(id);
            conversations.reload();
          }}
        />

        {/*
          La lista va a la DERECHA y en segundo plano. Es historial, no la función: ponerla
          primero hacía que lo primero que se veía al entrar fuera una columna vacía.
        */}
        <Section title={t('ask.list.title')} flush>
          <div className="px-5 pb-5">
            <ErrorNote error={conversations.error} />
            <Button
              className="w-full"
              variant="secondary"
              onClick={() => setActiveId(null)}
            >
              {t('ask.new')}
            </Button>
          </div>

          {conversations.data?.length === 0 && (
            <p className="px-5 pb-5 t-small text-muted">{t('ask.emptyList')}</p>
          )}

          {(conversations.data?.length ?? 0) > 0 && (
            <ul className="border-t border-line p-2">
              {conversations.data?.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(conversation.id)}
                    aria-current={conversation.id === activeId ? 'true' : undefined}
                    className={`w-full truncate rounded-md px-3 py-2 text-left t-small transition-colors ${
                      conversation.id === activeId
                        ? 'bg-accent-soft font-medium text-accent'
                        : 'text-muted hover:bg-sunken hover:text-ink'
                    }`}
                  >
                    {/* El título es la propia pregunta de la persona: contenido suyo, en su
                        idioma. Solo se traduce el hueco cuando no hay ninguno. */}
                    {conversation.title ?? t('ask.untitled')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

/** Los ejemplos que se ofrecen al entrar. Son claves: se traducen con el idioma activo. */
const EJEMPLOS: TranslationKey[] = [
  'ask.example1',
  'ask.example2',
  'ask.example3',
];

/**
 * El hilo: historial, pregunta y respuesta.
 *
 * `conversationId` nulo significa "todavía no existe": la conversación se crea con el primer
 * mensaje, no al abrir la pantalla. Crear una conversación vacía por si acaso llenaría la lista
 * de hilos que nadie escribió.
 */
function Thread({
  conversationId,
  onStarted,
}: {
  conversationId: string | null;
  onStarted: (conversationId: string) => void;
}) {
  const t = useT();
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [answer, setAnswer] = useState<SentMessage | null>(null);
  const action = useAction();
  const bottom = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  const history = useResource(
    () =>
      conversationId
        ? api<Conversation>(`/conversations/${conversationId}`)
        : Promise.resolve(null),
    [conversationId],
  );

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [answer, pending, history.data]);

  const messages: ConversationMessage[] = history.data?.messages ?? [];
  // El último turno se muestra desde la respuesta recién recibida, que trae las citas y la
  // comprensión utilizada; el historial persistido solo guarda las citas.
  const alreadyShown = answer
    ? new Set([answer.userMessageId, answer.assistantMessageId])
    : new Set<string>();

  const virgen = !conversationId && !pending && !answer;

  const ask = async (texto?: string) => {
    const content = (texto ?? question).trim();
    if (!content) return;

    setPending(content);
    setQuestion('');
    try {
      // La conversación nace con el primer mensaje. El título es la propia pregunta recortada:
      // es lo que permite reconocerla después en la lista.
      const target =
        conversationId ??
        (
          await api<Conversation>('/conversations', {
            method: 'POST',
            body: { title: content.slice(0, 80) },
          })
        ).id;

      const sent = await api<SentMessage>(`/conversations/${target}/messages`, {
        method: 'POST',
        body: { content },
      });

      setAnswer(sent);
      setPending(null);
      if (!conversationId) onStarted(target);
      else history.reload();
    } catch (error) {
      // La pregunta no se pierde: se devuelve al cuadro para poder reintentar.
      setQuestion(content);
      setPending(null);
      throw error;
    }
  };

  const formulario = (
    <form
      className="space-y-3"
      onSubmit={action.onSubmit(() => ask())}
    >
      <label className="block">
        <span className="sr-only">{t('ask.input.label')}</span>
        <textarea
          ref={campo}
          rows={virgen ? 3 : 2}
          className={`${fieldClass} w-full resize-none ${virgen ? 't-lead' : ''}`}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            // Enter pregunta; Mayúsculas+Enter salta de línea. Es lo que espera cualquiera
            // que haya escrito en un chat, y evita que una pregunta larga se envíe a medias.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void action.run(() => ask());
            }
          }}
          placeholder={t('ask.input.placeholder')}
          required
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        <p className="t-fine text-muted">{t('ask.noInvent')}</p>
        <Button type="submit" disabled={action.busy || pending !== null}>
          {action.busy || pending ? t('ask.sending') : t('ask.send')}
        </Button>
      </div>
    </form>
  );

  // Conversación nueva: la pantalla es la pregunta. Nada compite con ella.
  if (virgen) {
    return (
      <div className="space-y-6">
        <ErrorNote error={history.error ?? action.error} />

        <div className="rounded-lg border border-line bg-surface p-5 shadow-card sm:p-6">
          <p className="mb-3 t-body text-ink-soft">{t('ask.intro')}</p>
          {formulario}
        </div>

        <div>
          <p className="t-micro text-muted">{t('ask.tryThis')}</p>
          {/*
            Antes eran viñetas grises. Ahora son botones: pulsar uno pregunta de verdad. Ver
            la primera respuesta con sus fuentes es lo que explica el producto — y hasta la
            Fase 8 exigía teclear la pregunta a mano.
          */}
          <ul className="mt-2 grid gap-2 sm:grid-cols-3">
            {EJEMPLOS.map((clave) => (
              <li key={clave}>
                <button
                  type="button"
                  onClick={() => void action.run(() => ask(t(clave)))}
                  disabled={action.busy}
                  className="h-full w-full rounded-md border border-line bg-surface p-3 text-left t-small text-ink-soft transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent disabled:opacity-50"
                >
                  {t(clave)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ErrorNote error={history.error ?? action.error} />

      <div className="space-y-5">
        {messages
          .filter((message) => !alreadyShown.has(message.id))
          .map((message) => (
            <Turn
              key={message.id}
              role={message.role}
              content={message.content}
              citations={message.citations ?? []}
            />
          ))}

        {answer && (
          <>
            <Turn
              role="USER"
              content={pendingOrAnswerQuestion(messages, answer)}
              citations={[]}
            />
            <Turn
              role="ASSISTANT"
              content={answer.content}
              citations={answer.citations}
              insightsUsed={answer.insightsUsed}
            />
          </>
        )}

        {pending && (
          <>
            <Turn role="USER" content={pending} citations={[]} />
            {/*
              Pensando: no es un texto suelto en gris. Ocupa el sitio de la respuesta que va a
              llegar y dice QUÉ está haciendo, que es lo que hace tolerable la espera.
            */}
            <div
              className="rounded-lg border border-line bg-surface p-4 shadow-card"
              role="status"
              aria-live="polite"
            >
              <p className="t-small font-medium text-ink">
                <span className="bb-pulse">{t('ask.thinking')}</span>
              </p>
              <p className="mt-1 t-small text-muted">{t('ask.thinkingHint')}</p>
            </div>
          </>
        )}

        <div ref={bottom} />
      </div>

      <div className="rounded-lg border border-line bg-surface p-4 shadow-card">
        {formulario}
      </div>
    </div>
  );
}

/**
 * Recupera el texto de la pregunta que produjo esta respuesta.
 *
 * Se busca en el historial por identificador en vez de guardarlo en un estado aparte: el
 * servidor es la única fuente de verdad de lo que quedó escrito en la conversación.
 */
function pendingOrAnswerQuestion(
  messages: ConversationMessage[],
  answer: SentMessage,
): string {
  return (
    messages.find((message) => message.id === answer.userMessageId)?.content ??
    ''
  );
}

/**
 * Un turno.
 *
 * La pregunta se ve como una nota de quien pregunta —discreta, alineada a la derecha— y la
 * respuesta como el documento que es: tarjeta a ancho completo, con sus fuentes debajo. Antes
 * las dos eran burbujas del mismo tamaño, lo que sugería una charla; esto no es una charla,
 * es una consulta con su respuesta documentada.
 */
function Turn({
  role,
  content,
  citations,
  insightsUsed,
}: {
  role: ConversationMessage['role'];
  content: string;
  citations: MessageCitation[];
  insightsUsed?: SentMessage['insightsUsed'];
}) {
  const t = useT();
  const labels = useLabels();
  const mine = role === 'USER';

  if (mine) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%]">
          <p className="mb-1 text-right t-micro text-muted">{t('ask.you')}</p>
          <p className="whitespace-pre-wrap rounded-lg bg-sunken px-4 py-2.5 t-body text-ink">
            {content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-card sm:p-5">
      <p className="mb-2 t-micro text-muted">{t('ask.brain')}</p>
      <p className="whitespace-pre-wrap t-body text-ink">{content}</p>

      {citations.length > 0 && <Sources citations={citations} />}

      {/* Sin citas NO se disimula: una respuesta que no se apoya en nada no vale para tomar
          una decisión, y quien lee tiene derecho a saberlo. */}
      {citations.length === 0 && (
        <p className="mt-3 rounded-md bg-attention-soft px-3 py-2 t-small text-attention">
          {t('ask.noSources')}
        </p>
      )}

      {insightsUsed && insightsUsed.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
          {insightsUsed.map((insight) => (
            <li key={insight.id} className="flex flex-wrap items-center gap-2">
              <Link
                className="t-small text-accent underline underline-offset-2"
                to={`/insights/${insight.id}`}
              >
                {insight.summary}
              </Link>
              <StatusPill
                tone={insight.freshness === 'FRESH' ? 'positive' : 'attention'}
              >
                {labels.freshness(insight.freshness)}
              </StatusPill>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * De qué documentos salió la respuesta.
 *
 * Cada cita enlaza al documento real y muestra su título ORIGINAL, sin traducir: es el nombre
 * con el que la persona lo va a encontrar. El nombre se resuelve contra `/knowledge-items`, que
 * ya está acotado por alcance: si una cita apuntara a algo fuera del alcance del lector —no
 * debería ocurrir, porque el turno se preparó con su alcance— aquí no aparecería un título, y
 * eso es lo correcto.
 */
function Sources({ citations }: { citations: MessageCitation[] }) {
  const t = useT();
  const formatDate = useFormatDate();
  const items = useResource(() => api<KnowledgeItem[]>('/knowledge-items'), []);

  const titleOf = (knowledgeItemId: string) =>
    items.data?.find((item) => item.id === knowledgeItemId)?.title;

  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="t-micro text-muted">{t('ask.sources')}</p>
      <ol className="mt-2 space-y-1.5">
        {citations.map((citation) => {
          const item = items.data?.find(
            (candidate) => candidate.id === citation.knowledgeItemId,
          );
          return (
            <li
              key={`${citation.ordinal}-${citation.chunkId}`}
              className="flex flex-wrap items-baseline gap-x-2 t-small text-ink-soft"
            >
              <span className="t-figure font-medium text-accent">
                [{citation.ordinal}]
              </span>
              <span>{titleOf(citation.knowledgeItemId) ?? citation.label}</span>
              {item?.sourceMissingSince && (
                <StatusPill tone="attention">
                  {t('ask.sourceMissing')}
                </StatusPill>
              )}
              {item && (
                <span className="t-fine text-faint">
                  {t('ask.indexedAt', { date: formatDate(item.indexedAt) })}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

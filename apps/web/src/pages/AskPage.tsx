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
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  inputClass,
  useAction,
  useFormatDate,
  useResource,
} from '../components/ui';
import { useT } from '../i18n';
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
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <Card title={t('ask.list.title')}>
        <ErrorNote error={conversations.error} />
        <Button
          className="mb-3 w-full"
          variant="secondary"
          onClick={() => setActiveId(null)}
        >
          {t('ask.new')}
        </Button>

        {conversations.loading && <Empty>{t('common.loading')}</Empty>}
        <ul className="space-y-1">
          {conversations.data?.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => setActiveId(conversation.id)}
                className={`w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                  conversation.id === activeId
                    ? 'bg-blue-50 font-medium text-blue-800'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {/* El título es la propia pregunta de la persona: contenido suyo, en su
                    idioma. Solo se traduce el hueco cuando no hay ninguno. */}
                {conversation.title ?? t('ask.untitled')}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Thread
        key={activeId ?? 'nueva'}
        conversationId={activeId}
        onStarted={(id) => {
          setActiveId(id);
          conversations.reload();
        }}
      />
    </div>
  );
}

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

  const ask = async () => {
    const content = question.trim();
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

  return (
    <Card title={t('ask.title')}>
      <ErrorNote error={history.error ?? action.error} />

      {!conversationId && !pending && !answer && (
        <div className="mb-4 rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          <p className="font-medium text-gray-800">{t('ask.intro')}</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
            <li>{t('ask.example1')}</li>
            <li>{t('ask.example2')}</li>
            <li>{t('ask.example3')}</li>
          </ul>
          <p className="mt-2 text-xs">{t('ask.noInvent')}</p>
        </div>
      )}

      <div className="max-h-[28rem] space-y-4 overflow-y-auto">
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
            <p className="text-sm text-gray-500">{t('ask.thinking')}</p>
          </>
        )}

        <div ref={bottom} />
      </div>

      <form
        className="mt-4 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3"
        onSubmit={action.onSubmit(ask)}
      >
        <input
          aria-label={t('ask.input.label')}
          className={`${inputClass} min-w-48 flex-1`}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t('ask.input.placeholder')}
          required
        />
        <Button type="submit" disabled={action.busy || pending !== null}>
          {action.busy || pending ? t('ask.sending') : t('ask.send')}
        </Button>
      </form>
    </Card>
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

  return (
    <div className={mine ? 'text-right' : ''}>
      <div
        className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left text-sm ${
          mine ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'
        }`}
      >
        {content}
      </div>

      {!mine && citations.length > 0 && <Sources citations={citations} />}

      {/* Sin citas NO se disimula: una respuesta que no se apoya en nada no vale para tomar
          una decisión, y quien lee tiene derecho a saberlo. */}
      {!mine && citations.length === 0 && (
        <p className="mt-1 text-xs text-amber-700">{t('ask.noSources')}</p>
      )}

      {!mine && insightsUsed && insightsUsed.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-gray-500">
          {insightsUsed.map((insight) => (
            <li key={insight.id}>
              <Link className="underline" to={`/insights/${insight.id}`}>
                {insight.summary}
              </Link>{' '}
              <Badge tone={insight.freshness === 'FRESH' ? 'good' : 'warn'}>
                {labels.freshness(insight.freshness)}
              </Badge>
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
    <div className="mt-2">
      <p className="text-xs font-medium text-gray-600">{t('ask.sources')}</p>
      <ol className="mt-1 space-y-1 text-xs text-gray-600">
        {citations.map((citation) => {
          const item = items.data?.find(
            (candidate) => candidate.id === citation.knowledgeItemId,
          );
          return (
            <li key={`${citation.ordinal}-${citation.chunkId}`}>
              <span className="font-medium">[{citation.ordinal}]</span>{' '}
              {titleOf(citation.knowledgeItemId) ?? citation.label}
              {item?.sourceMissingSince && (
                <>
                  {' '}
                  <Badge tone="warn">{t('ask.sourceMissing')}</Badge>
                </>
              )}
              {item && (
                <span className="text-gray-400">
                  {' · '}
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

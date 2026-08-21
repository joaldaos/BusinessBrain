import { freshnessLabel } from '../api/labels';
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
  formatDate,
  inputClass,
  useAction,
  useResource,
} from '../components/ui';

/**
 * Preguntarle a la empresa.
 *
 * ## Por qué esta pantalla es el producto
 *
 * Todo lo demás —conectar fuentes, versionar, clasificar, analizar— es infraestructura que una
 * PYME no puede evaluar. Esto sí: se escribe una pregunta en castellano y se obtiene una
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
 * ## El alcance es de la PERSONA
 *
 * La conversación se crea sin agente, y ese camino prepara el turno con las colecciones
 * concedidas a quien pregunta. Dos personas de la misma empresa pueden hacer la misma pregunta
 * y recibir respuestas distintas, y eso es correcto: cada una ve lo que tiene concedido.
 */
export function AskPage() {
  const conversations = useResource(() =>
    api<Conversation[]>('/conversations'),
  );
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
      <Card title="Tus preguntas">
        <ErrorNote error={conversations.error} />
        <Button
          className="mb-3 w-full"
          variant="secondary"
          onClick={() => setActiveId(null)}
        >
          Nueva pregunta
        </Button>

        {conversations.loading && <Empty>Cargando…</Empty>}
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
                {conversation.title ?? 'Sin título'}
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

      const sent = await api<SentMessage>(
        `/conversations/${target}/messages`,
        { method: 'POST', body: { content } },
      );

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
    <Card title="Pregúntale a tu empresa">
      <ErrorNote error={history.error ?? action.error} />

      {!conversationId && !pending && !answer && (
        <div className="mb-4 rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          <p className="font-medium text-gray-800">
            Pregunta con tus palabras. Responderá con lo que sabe de tu empresa.
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
            <li>¿Qué acordamos con nuestro principal proveedor?</li>
            <li>¿Cuál es nuestra política de descuentos?</li>
            <li>¿Qué hemos decidido sobre las devoluciones?</li>
          </ul>
          <p className="mt-2 text-xs">
            Si no tiene información suficiente, lo dirá en lugar de inventarla.
          </p>
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
            <Turn role="USER" content={pendingOrAnswerQuestion(messages, answer)} citations={[]} />
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
            <p className="text-sm text-gray-500">Buscando en tu conocimiento…</p>
          </>
        )}

        <div ref={bottom} />
      </div>

      <form
        className="mt-4 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3"
        onSubmit={action.onSubmit(ask)}
      >
        <input
          aria-label="Tu pregunta"
          className={`${inputClass} min-w-48 flex-1`}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="¿Qué quieres saber de tu empresa?"
          required
        />
        <Button type="submit" disabled={action.busy || pending !== null}>
          {action.busy || pending ? 'Preguntando…' : 'Preguntar'}
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
        <p className="mt-1 text-xs text-amber-700">
          Sin fuentes: esta respuesta no se apoya en ningún documento tuyo.
        </p>
      )}

      {!mine && insightsUsed && insightsUsed.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-gray-500">
          {insightsUsed.map((insight) => (
            <li key={insight.id}>
              <Link className="underline" to={`/insights/${insight.id}`}>
                {insight.summary}
              </Link>{' '}
              <Badge tone={insight.freshness === 'FRESH' ? 'good' : 'warn'}>
                {freshnessLabel(insight.freshness)}
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
 * Cada cita enlaza al documento real. El nombre se resuelve contra `/knowledge-items`, que ya
 * está acotado por alcance: si una cita apuntara a algo fuera del alcance del lector —no debería
 * ocurrir, porque el turno se preparó con su alcance— aquí no aparecería un título, y eso es lo
 * correcto.
 */
function Sources({ citations }: { citations: MessageCitation[] }) {
  const items = useResource(() => api<KnowledgeItem[]>('/knowledge-items'), []);

  const titleOf = (knowledgeItemId: string) =>
    items.data?.find((item) => item.id === knowledgeItemId)?.title;

  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-gray-600">Fuentes</p>
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
                  <Badge tone="warn">ya no está en su origen</Badge>
                </>
              )}
              {item && (
                <span className="text-gray-400">
                  {' '}
                  · indexado {formatDate(item.indexedAt)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

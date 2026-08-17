/**
 * De un mensaje de Gmail a conocimiento — dominio puro.
 *
 * Aquí se decide qué parte de un correo ES conocimiento y qué parte es solo metadata
 * operativa. La separación no es cosmética: `contentText` se trocea, se vectoriza, se recupera
 * y acaba en informes descargables; la metadata operativa no sale nunca de la base de datos.
 *
 * ## Tres decisiones que este dominio implementa
 *
 * 1. **La dirección del remitente NO es conocimiento.** Es dato personal y, puesta en el
 *    texto, aparecería en embeddings, en respuestas del chat y en PDFs que cualquiera con la
 *    colección concedida puede descargar. Se usa el NOMBRE para contextualizar y la dirección
 *    queda como metadata operativa, disponible para trazar pero no para recuperar.
 * 2. **El historial citado se recorta.** Un correo de respuesta arrastra todo el hilo. Sin
 *    recortarlo, cada mensaje reingiere lo anterior: redundancia en los vectores y —peor— dos
 *    respuestas consecutivas se parecen tanto que la deduplicación estructural las tomaría
 *    por versiones del mismo documento.
 * 3. **El título es único por mensaje.** La deduplicación de nivel 2 busca candidatos por
 *    igualdad de título dentro de la misma fuente. Si el título fuera solo el asunto, dos
 *    respuestas de un hilo compartirían título y la segunda se registraría como una VERSIÓN
 *    de la primera, marcándola superada. Añadir remitente y fecha lo hace imposible.
 *
 * Sin base de datos, sin red, determinista.
 */

/** Lo que Gmail entrega de un mensaje, ya extraído por el adaptador. */
export interface GmailMessageInput {
  id: string;
  threadId: string;
  subject: string | null;
  /** Nombre visible del remitente, si venía. */
  fromName: string | null;
  /** Dirección del remitente. Metadata OPERATIVA: nunca entra en el contenido. */
  fromAddress: string | null;
  /** Fecha de envío en ISO. */
  sentAt: string | null;
  /** Cuerpo en texto plano, ya convertido si venía en HTML. */
  body: string;
  labelIds: string[];
}

export interface KnowledgeFromMessage {
  title: string;
  /** Lo que SÍ se indexa y se recupera. */
  contentText: string;
  /** Lo que NO se indexa: sirve para sincronizar, agrupar y trazar. */
  sourceMetadata: {
    provider: 'GMAIL';
    messageId: string;
    threadId: string;
    /** Dato personal fuera del conocimiento recuperable, por decisión de producto. */
    fromAddress: string | null;
    sentAt: string | null;
    labelIds: string[];
  };
}

/** Un correo por debajo de esto no aporta conocimiento y sí colisiones de hash. */
export const MIN_MESSAGE_TEXT_LENGTH = 60;
/** Tope por mensaje: un correo con un volcado de registro no puede reventar la ingesta. */
export const MAX_MESSAGE_TEXT_LENGTH = 100_000;

const UNTITLED = '(sin asunto)';

/**
 * Recorta el historial citado de una respuesta.
 *
 * Se cortan las tres formas habituales, en cuanto aparece la primera: la línea de atribución
 * («El 12 ago 2026, X escribió:»), los separadores de reenvío, y los bloques con `>`. A
 * partir de ahí, todo lo que sigue es el mensaje anterior, que ya se ingirió por su cuenta.
 */
export function stripQuotedHistory(body: string): string {
  const lines = body.split(/\r?\n/);
  const cut = lines.findIndex((line) => isQuoteBoundary(line));
  const kept = cut === -1 ? lines : lines.slice(0, cut);

  return kept
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isQuoteBoundary(line: string): boolean {
  const text = line.trim();
  if (text.length === 0) return false;

  return (
    // Atribución de Gmail en español e inglés, con o sin nombre entre <>.
    /^El .+ escribi(ó|o):$/i.test(text) ||
    /^On .+ wrote:$/i.test(text) ||
    // Separadores de reenvío y de cliente de correo.
    /^-{2,}\s*(Mensaje original|Mensaje reenviado|Original Message|Forwarded message)/i.test(
      text,
    ) ||
    /^_{5,}$/.test(text)
  );
}

/**
 * Compone el conocimiento de un mensaje, o `null` si no aporta ninguno.
 *
 * Devolver `null` en vez de lanzar es deliberado: un buzón real está lleno de «gracias»,
 * confirmaciones automáticas y firmas sueltas, y ninguna de esas cosas debe hacer fallar una
 * sincronización.
 */
export function knowledgeFromMessage(
  message: GmailMessageInput,
): KnowledgeFromMessage | null {
  const body = stripQuotedHistory(message.body).slice(
    0,
    MAX_MESSAGE_TEXT_LENGTH,
  );
  if (body.length < MIN_MESSAGE_TEXT_LENGTH) return null;

  const subject = message.subject?.trim() || UNTITLED;
  const senderName = message.fromName?.trim();

  return {
    title: buildTitle({ subject, senderName, sentAt: message.sentAt }),
    // El encabezado da contexto —de quién y de cuándo es esto— sin incluir la dirección.
    contentText: [
      `Asunto: ${subject}`,
      senderName ? `De: ${senderName}` : null,
      message.sentAt ? `Fecha: ${message.sentAt}` : null,
      '',
      body,
    ]
      .filter((line): line is string => line !== null)
      .join('\n'),
    sourceMetadata: {
      provider: 'GMAIL',
      messageId: message.id,
      threadId: message.threadId,
      fromAddress: message.fromAddress,
      sentAt: message.sentAt,
      labelIds: message.labelIds,
    },
  };
}

/**
 * Título ÚNICO por mensaje.
 *
 * Lleva remitente y fecha porque el asunto solo no distingue dos respuestas del mismo hilo, y
 * la deduplicación estructural empareja candidatos por título: con el asunto solo, la segunda
 * respuesta se registraría como versión de la primera.
 */
function buildTitle(params: {
  subject: string;
  senderName?: string;
  sentAt: string | null;
}): string {
  const parts = [params.subject];
  if (params.senderName) parts.push(params.senderName);
  if (params.sentAt) parts.push(params.sentAt);

  return parts.join(' — ').slice(0, 300);
}

/**
 * ¿Está el mensaje dentro de la etiqueta que la organización eligió sincronizar?
 *
 * Se comprueba de este lado además de pedirlo a Gmail. El filtro de la API es una consulta, no
 * una garantía: un cambio de parámetros, un error de paginación o una respuesta inesperada
 * podrían traer mensajes de fuera del perímetro que la persona aceptó. Fail-closed.
 */
export function belongsToSyncedLabel(
  message: { labelIds: string[] },
  labelId: string,
): boolean {
  return message.labelIds.includes(labelId);
}

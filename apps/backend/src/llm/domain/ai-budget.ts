/**
 * El techo de gasto en IA de una empresa, por día.
 *
 * ## De qué protege exactamente
 *
 * De que un cliente se encuentre una factura que no esperaba. No de un atacante: de sí mismo.
 * El caso real es alguien que sube su carpeta entera de documentos "a ver qué pasa", o una
 * automatización mal configurada que analiza en bucle. La clave del proveedor es SUYA y el
 * cargo le llega a él, así que un descuido nuestro se convierte en dinero suyo.
 *
 * ## Por qué se miden CARACTERES y no llamadas ni euros
 *
 * Contar llamadas engaña: vectorizar un documento de doscientas páginas es una llamada, y
 * preguntar "¿cuánto vendimos?" también. Calcular euros exigiría conocer el precio de cada
 * modelo de cada proveedor y mantenerlo al día — eso es facturación, y facturación es
 * justamente lo que aquí NO se está construyendo.
 *
 * Los caracteres de entrada son lo que sí se sabe con certeza en el momento de la llamada,
 * sin preguntarle nada a nadie, y son proporcionales al coste real (~4 caracteres por token en
 * castellano). Es una aproximación, y suficiente: esto es un tope de seguridad, no un contador
 * de la luz.
 *
 * ## Por qué el día natural
 *
 * Porque es lo que una persona entiende sin que se lo expliquen: "hoy has llegado al límite,
 * mañana vuelve a estar disponible". Una ventana deslizante de 24 horas sería más justa y
 * mucho más difícil de explicar por teléfono.
 */

/** Métrica bajo la que se acumula. `UsageRecord.metric` es texto libre por diseño. */
export const AI_CHARACTERS_METRIC = 'ai_input_characters';

/**
 * Cinco millones de caracteres al día: del orden de dos mil páginas vectorizadas, o varios
 * cientos de preguntas. Muy por encima de un día normal de una PYME, y muy por debajo de una
 * factura que asuste.
 */
export const DEFAULT_DAILY_CHARACTER_LIMIT = 5_000_000;

/**
 * El techo de esta empresa.
 *
 * Vive en `Organization.settings`, junto a la exigencia de fiabilidad, y no en una columna:
 * es un ajuste operativo que cada empresa mueve, no una propiedad del modelo. Un valor
 * inválido o ausente cae al de por defecto — una errata en un ajuste no puede dejar a nadie
 * sin producto ni sin techo.
 */
export function dailyCharacterLimitFrom(settings: unknown): number {
  const ai = (settings as { ai?: { dailyCharacterLimit?: unknown } } | null)
    ?.ai;
  const value = ai?.dailyCharacterLimit;

  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_DAILY_CHARACTER_LIMIT;
}

/** El día natural que contiene ese instante, en el reloj del servidor. */
export function dayWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
}

/**
 * Cuánto texto lleva una petición al modelo.
 *
 * Se suma todo lo que viaja: los mensajes y las instrucciones del sistema. Contar solo la
 * pregunta del usuario dejaría fuera precisamente los fragmentos de documentos recuperados,
 * que son la parte grande.
 */
export function charactersInMessages(
  messages: { content?: unknown }[] | undefined,
): number {
  if (!Array.isArray(messages)) return 0;

  return messages.reduce<number>(
    (total, message) =>
      total +
      (typeof message.content === 'string' ? message.content.length : 0),
    0,
  );
}

export function charactersInTexts(texts: string[] | undefined): number {
  if (!Array.isArray(texts)) return 0;
  return texts.reduce((total, text) => total + text.length, 0);
}

/**
 * Cuántos hechos puede traer una empresa al día.
 *
 * ## De qué protege, y por qué es distinto del techo de IA
 *
 * El techo de IA protege al cliente de su propia factura: la clave del proveedor es suya y el
 * cargo le llega a él. **Este techo nos protege a nosotros.** El almacenamiento de los hechos
 * es nuestro, y el coste real llega después: cada hecho acaba entrando en medias, ventanas y
 * comparaciones.
 *
 * El caso que lo justifica no es un ataque: es un TPV mal configurado reenviando el mismo día
 * en bucle, o una recuperación de histórico que alguien lanza sobre cinco años de tickets sin
 * pensar en cuántos son. La idempotencia impide que se dupliquen; no impide que sean
 * demasiados.
 *
 * ## Por qué se cuentan hechos y no bytes
 *
 * Porque es lo que se sabe sin abrir nada, y porque es la unidad en la que crece el coste
 * posterior: una fila más es una fila más en cada agregación, mida lo que mida.
 *
 * ## Por qué pasarse NO es un error
 *
 * Una sincronización que se pasa del techo no "falla": ha hecho su trabajo hasta donde se le
 * permite. Tratarlo como fallo gastaría los reintentos de la cola en algo que no se arregla
 * reintentando —sino esperando a mañana— y acabaría enterrando el conector, que entonces
 * dejaría de sincronizar hasta que alguien lo tocara. Se registra como omitida, con el motivo,
 * y el día siguiente vuelve sola.
 */

/** Métrica bajo la que se acumula. `UsageRecord.metric` es texto libre por diseño. */
export const CONNECTOR_EVENTS_METRIC = 'connector_events';

/**
 * Cincuenta mil hechos al día.
 *
 * Un restaurante con mucho movimiento genera del orden de dos mil comandas diarias, y cada
 * una son cuatro o cinco hechos: unos diez mil. El techo deja holgura de sobra para un día
 * excepcional y corta mucho antes de que un bucle haga daño.
 */
export const DEFAULT_DAILY_EVENT_LIMIT = 50_000;

/**
 * El techo de esta empresa.
 *
 * Vive en `Organization.settings`, junto al de IA y a la exigencia de fiabilidad: es un ajuste
 * operativo, no una propiedad del modelo. Un valor inválido o ausente cae al de por defecto —
 * una errata en un ajuste no puede dejar a nadie sin producto ni sin techo.
 */
export function dailyEventLimitFrom(settings: unknown): number {
  const connectors = (
    settings as { connectors?: { dailyEventLimit?: unknown } } | null
  )?.connectors;
  const value = connectors?.dailyEventLimit;

  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_DAILY_EVENT_LIMIT;
}

/** Lo que queda por consumir hoy. Nunca negativo. */
export function remainingToday(limit: number, used: number): number {
  return Math.max(0, limit - used);
}

/**
 * Qué se le cuenta a la empresa cuando se alcanza el techo.
 *
 * En su idioma y sin hablar de métricas ni de ventanas: qué ha pasado, cuándo se arregla solo
 * y qué puede hacer. Es el mismo criterio que el mensaje del techo de IA.
 */
export function budgetReachedMessage(limit: number): string {
  return (
    `Se ha alcanzado el máximo de ${limit.toLocaleString('es-ES')} registros por día para ` +
    `esta conexión. Es un tope de seguridad para que una configuración equivocada no llene ` +
    `tu cuenta de datos repetidos. Mañana vuelve a leer con normalidad; si tu negocio ` +
    `genera más, un administrador puede subirlo desde Configuración.`
  );
}

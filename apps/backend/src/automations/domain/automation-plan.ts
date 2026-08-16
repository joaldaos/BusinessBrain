/**
 * Plan de una automatización — BUSINESSBRAIN_MIGRATION_PLAN.md §5, §10 (fase 6).
 *
 * ## Por qué el catálogo de acciones es CERRADO
 *
 * El esquema guarda `actions` como `Json`: una lista de pasos con forma libre. Aceptarla tal
 * cual convertiría una automatización en un intérprete de instrucciones arbitrarias que se
 * ejecutan sin nadie delante — exactamente la vía por la que el Principio de Evolución
 * Asistida ("siempre propone, nunca modifica automáticamente") dejaría de sostenerse, porque
 * el principio no lo garantizaría la arquitectura sino la buena fe de quien redacta el JSON.
 *
 * El catálogo arranca con una sola acción a propósito: `RUN_ANALYSIS` es la que hace que el
 * motor de comprensión funcione solo, y es ejecutable de principio a fin hoy. Ejecutar un
 * agente o generar un informe necesitan un DESTINO para su salida, y ese destino es
 * `ReportsModule` — llegan con él. Declarar aquí una acción que pudiera crearse pero no
 * ejecutarse dejaría una automatización que falla de madrugada, en silencio.
 *
 * Una automatización ORQUESTA capacidades internas que ya existen y que ya son seguras por su
 * cuenta. No añade ninguna capacidad nueva, y sobre todo no añade la de tocar el mundo
 * exterior: nada de correos, llamadas a terceros ni escrituras fuera del tenant. Lo que
 * produce es comprensión, propuestas e informes que una persona revisará.
 *
 * ## Por qué el disparo se valida aquí y no al ejecutar
 *
 * Una expresión de calendario mal formada que solo falla al dispararse deja una automatización
 * "activa" que no corre nunca y nadie se entera hasta que alguien echa de menos el resultado.
 * Se rechaza al crearla, cuando hay una persona esperando la respuesta.
 *
 * Dominio puro: sin base de datos, sin red, determinista.
 */

/**
 * Lo que una automatización puede hacer. CERRADO.
 *
 * Cada acción corresponde a una capacidad que ya existe y que ya aplica sus propias reglas
 * —alcance, gate de riesgo, curación, auditoría—. La automatización decide CUÁNDO, jamás
 * relaja el QUÉ.
 */
export const AUTOMATION_ACTION_TYPES = [
  /** Lanza un `AnalysisRun`: el motor de comprensión razona sobre el conocimiento actual. */
  'RUN_ANALYSIS',
] as const;

export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export type AutomationAction = { type: 'RUN_ANALYSIS' };

/** Tope de pasos por automatización: una lista sin cota es una ejecución sin cota. */
export const MAX_ACTIONS_PER_AUTOMATION = 10;

export class InvalidAutomationPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAutomationPlanError';
  }
}

const ACTION_TYPES = new Set<string>(AUTOMATION_ACTION_TYPES);

/**
 * Valida y normaliza la lista de acciones.
 *
 * Fail-closed en todos los sentidos: un tipo desconocido no se ignora ni se salta, se rechaza.
 * Saltárselo dejaría una automatización que dice hacer tres cosas y hace dos, sin que nadie
 * pueda saber cuál falta mirando su definición.
 */
export function parseAutomationActions(raw: unknown): AutomationAction[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new InvalidAutomationPlanError(
      'Una automatización debe declarar al menos una acción',
    );
  }
  if (raw.length > MAX_ACTIONS_PER_AUTOMATION) {
    throw new InvalidAutomationPlanError(
      `Una automatización no puede declarar más de ${MAX_ACTIONS_PER_AUTOMATION} acciones`,
    );
  }

  return raw.map((entry, index) => parseAction(entry, index));
}

function parseAction(raw: unknown, index: number): AutomationAction {
  const position = `La acción ${index + 1}`;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new InvalidAutomationPlanError(`${position} no es una acción válida`);
  }

  const action = raw as Record<string, unknown>;
  const type = action.type;

  if (typeof type !== 'string' || !ACTION_TYPES.has(type)) {
    throw new InvalidAutomationPlanError(
      `${position} declara un tipo desconocido. Las automatizaciones solo orquestan ` +
        `capacidades internas ya existentes: ${AUTOMATION_ACTION_TYPES.join(', ')}`,
    );
  }

  switch (type as AutomationActionType) {
    case 'RUN_ANALYSIS':
      return { type: 'RUN_ANALYSIS' };
  }
}

/**
 * Expresión de calendario de una automatización programada.
 *
 * Se acepta cron de CINCO campos (minuto hora día mes día-de-semana). Sin segundos: una
 * automatización que orquesta análisis y agentes no tiene granularidad de segundo, y
 * permitirla invitaría a programar barridos cada pocos segundos sobre un motor que llama a
 * modelos de lenguaje.
 */
export interface ScheduleTrigger {
  cron: string;
  /** Zona horaria IANA. "el lunes a las 8" no significa lo mismo en Madrid que en Bogotá. */
  timezone: string;
}

/** Intervalo mínimo entre disparos, en minutos. Cota operativa, no invariante de dominio. */
export const MIN_SCHEDULE_INTERVAL_MINUTES = 15;

const CRON_FIELD_PATTERN =
  /^(\*|(\d+|\*)(\/\d+)?|\d+-\d+(\/\d+)?)(,(\d+|\*|\d+-\d+)(\/\d+)?)*$/;

/**
 * Valida la forma de una expresión cron de cinco campos.
 *
 * No calcula la próxima ejecución: eso lo hace el adaptador de calendario, que es quien
 * conoce la librería concreta. Aquí solo se decide si la expresión es aceptable, para poder
 * rechazarla mientras hay una persona esperando la respuesta.
 */
export function parseScheduleTrigger(raw: unknown): ScheduleTrigger {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new InvalidAutomationPlanError(
      'Una automatización programada debe declarar su calendario',
    );
  }

  const config = raw as Record<string, unknown>;
  const cron = config.cron;
  if (typeof cron !== 'string' || cron.trim().length === 0) {
    throw new InvalidAutomationPlanError(
      'Una automatización programada debe declarar una expresión cron',
    );
  }

  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new InvalidAutomationPlanError(
      'La expresión cron debe tener cinco campos: minuto hora día mes día-de-semana. ' +
        'No se admiten segundos',
    );
  }
  if (!fields.every((field) => CRON_FIELD_PATTERN.test(field))) {
    throw new InvalidAutomationPlanError(
      `Expresión cron no válida: "${cron.trim()}"`,
    );
  }

  const timezone = config.timezone;
  if (typeof timezone !== 'string' || timezone.trim().length === 0) {
    throw new InvalidAutomationPlanError(
      'Una automatización programada debe declarar su zona horaria: "los lunes a las 8" ' +
        'no significa lo mismo en cada sitio',
    );
  }

  return { cron: fields.join(' '), timezone: timezone.trim() };
}

/**
 * Configuración de un `Agent` — BUSINESSBRAIN_MIGRATION_PLAN.md §7.4.
 *
 * Un agente **no es un system prompt**: es capacidades, herramientas con permiso individual,
 * memoria y guardrails. En el esquema esas cuatro cosas viven como `Json` libre, lo que
 * significa que sin este módulo cualquier objeto sería aceptable — incluida una herramienta
 * inexistente o un permiso inventado, que solo fallarían al intentar ejecutarse.
 *
 * Aquí se valida la configuración ENTERA antes de persistirla. Es dominio puro: sin base de
 * datos, sin red y determinista, de modo que la misma configuración siempre se acepta o se
 * rechaza igual, y el rechazo explica qué está mal.
 */

/** Herramientas que la plataforma reconoce. Declarar una fuera de esta lista es un error. */
export const KNOWN_TOOLS = [
  'knowledge_search',
  'insight_lookup',
  'sql_query',
  'http_request',
  'send_email',
  'generate_report',
  'trigger_automation',
] as const;
export type KnownTool = (typeof KNOWN_TOOLS)[number];

/**
 * Permiso con el que un agente puede usar una herramienta concreta.
 *
 * - `READ_ONLY`: consulta sin efectos fuera del sistema.
 * - `REQUIRES_CONFIRMATION`: tiene efectos; exige confirmación humana explícita.
 * - `AUTONOMOUS`: tiene efectos y el agente puede provocarlos por su cuenta.
 */
export const TOOL_PERMISSIONS = [
  'READ_ONLY',
  'REQUIRES_CONFIRMATION',
  'AUTONOMOUS',
] as const;
export type ToolPermission = (typeof TOOL_PERMISSIONS)[number];

/**
 * Herramientas SIN efectos fuera del sistema. Todo lo que no esté aquí produce efectos y,
 * por tanto, no admite `READ_ONLY`: declararlo así sería mentir sobre lo que hace.
 */
const SIDE_EFFECT_FREE_TOOLS: ReadonlySet<string> = new Set<KnownTool>([
  'knowledge_search',
  'insight_lookup',
  'sql_query',
]);

export const AGENT_CAPABILITIES = [
  'answer_questions',
  'generate_report',
  'trigger_automation',
  'summarize',
] as const;
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export const MEMORY_STRATEGIES = ['none', 'short_term', 'long_term'] as const;
export type MemoryStrategy = (typeof MEMORY_STRATEGIES)[number];

export interface AgentToolConfig {
  tool: KnownTool;
  permission: ToolPermission;
}

export interface AgentMemoryConfig {
  strategy: MemoryStrategy;
  /** Cuántas entradas de memoria se recuperan. Solo aplica si la estrategia no es `none`. */
  windowSize: number;
}

export interface AgentGuardrails {
  /** Temas sobre los que el agente no debe pronunciarse. */
  forbiddenTopics: string[];
  /** Condiciones ante las que debe pasar el turno a una persona. */
  escalateToHumanWhen: string[];
  /** Tope de herramientas ejecutadas en un mismo turno. */
  maxToolCallsPerRun: number;
}

export interface AgentConfiguration {
  capabilities: AgentCapability[];
  tools: AgentToolConfig[];
  memoryConfig: AgentMemoryConfig;
  guardrails: AgentGuardrails;
}

export class InvalidAgentConfigurationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuración de agente inválida: ${problems.join('; ')}`);
    this.name = 'InvalidAgentConfigurationError';
  }
}

/**
 * Convierte a texto sin caer en `[object Object]`: lo que llega es `Json` libre y un objeto
 * anidado debe aparecer en el mensaje de error tal como vino, para que sea diagnosticable.
 */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  // Objetos y arrays se serializan; lo demás (symbol, function, bigint) no puede aparecer
  // en un `Json` de Prisma, pero se describe por tipo en vez de romper el mensaje.
  return JSON.stringify(value) ?? `[${typeof value}]`;
}

const DEFAULT_WINDOW_SIZE = 10;
const MAX_WINDOW_SIZE = 100;
const DEFAULT_MAX_TOOL_CALLS = 5;
const MAX_TOOL_CALLS_CEILING = 50;

/**
 * Valores por defecto de un agente recién creado que no declara nada.
 *
 * **Sin memoria y sin herramientas.** Un agente que no ha declarado qué puede hacer no puede
 * hacer nada: las capacidades se conceden, no se presuponen.
 */
export function defaultAgentConfiguration(): AgentConfiguration {
  return {
    capabilities: ['answer_questions'],
    tools: [],
    memoryConfig: { strategy: 'none', windowSize: DEFAULT_WINDOW_SIZE },
    guardrails: {
      forbiddenTopics: [],
      escalateToHumanWhen: [],
      maxToolCallsPerRun: DEFAULT_MAX_TOOL_CALLS,
    },
  };
}

/**
 * Valida y normaliza la configuración que llega como `Json` libre.
 *
 * Acumula TODOS los problemas antes de fallar, en vez de abortar en el primero: quien está
 * configurando un agente necesita la lista completa, no descubrirlos de uno en uno.
 */
export function parseAgentConfiguration(input: {
  capabilities?: unknown;
  tools?: unknown;
  memoryConfig?: unknown;
  guardrails?: unknown;
}): AgentConfiguration {
  const problems: string[] = [];
  const defaults = defaultAgentConfiguration();

  const capabilities = parseCapabilities(
    input.capabilities,
    defaults,
    problems,
  );
  const tools = parseTools(input.tools, problems);
  const memoryConfig = parseMemoryConfig(
    input.memoryConfig,
    defaults,
    problems,
  );
  const guardrails = parseGuardrails(input.guardrails, defaults, problems);

  if (problems.length > 0) throw new InvalidAgentConfigurationError(problems);

  return { capabilities, tools, memoryConfig, guardrails };
}

function parseCapabilities(
  raw: unknown,
  defaults: AgentConfiguration,
  problems: string[],
): AgentCapability[] {
  if (raw === undefined || raw === null) return defaults.capabilities;
  if (!Array.isArray(raw)) {
    problems.push('`capabilities` debe ser una lista');
    return defaults.capabilities;
  }

  const known = new Set<string>(AGENT_CAPABILITIES);
  const unknown = raw.filter((item) => !known.has(asText(item)));
  if (unknown.length > 0) {
    problems.push(
      `capacidades desconocidas: ${unknown.map(asText).join(', ')}. ` +
        `Reconocidas: ${AGENT_CAPABILITIES.join(', ')}`,
    );
  }

  // Duplicar una capacidad no la concede dos veces.
  return [...new Set(raw.map(asText))].filter((item) =>
    known.has(item),
  ) as AgentCapability[];
}

function parseTools(raw: unknown, problems: string[]): AgentToolConfig[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    problems.push('`tools` debe ser una lista');
    return [];
  }

  const knownTools = new Set<string>(KNOWN_TOOLS);
  const knownPermissions = new Set<string>(TOOL_PERMISSIONS);
  const parsed: AgentToolConfig[] = [];
  const seen = new Set<string>();

  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      problems.push(`tools[${index}] debe ser un objeto {tool, permission}`);
      continue;
    }

    const { tool, permission } = entry as {
      tool?: unknown;
      permission?: unknown;
    };
    const toolName = asText(tool);
    const permissionName = asText(permission);

    if (!knownTools.has(toolName)) {
      problems.push(
        `tools[${index}]: herramienta desconocida "${toolName}". ` +
          `Reconocidas: ${KNOWN_TOOLS.join(', ')}`,
      );
      continue;
    }
    if (!knownPermissions.has(permissionName)) {
      problems.push(
        `tools[${index}]: permiso inválido "${permissionName}". ` +
          `Válidos: ${TOOL_PERMISSIONS.join(', ')}`,
      );
      continue;
    }

    // Una herramienta con efectos declarada como READ_ONLY miente sobre lo que hace, y esa
    // mentira es justo la que el gate de políticas usaría para dejarla pasar.
    if (
      permissionName === 'READ_ONLY' &&
      !SIDE_EFFECT_FREE_TOOLS.has(toolName)
    ) {
      problems.push(
        `tools[${index}]: "${toolName}" produce efectos fuera del sistema y no puede ` +
          `declararse READ_ONLY`,
      );
      continue;
    }

    // La misma herramienta dos veces con permisos distintos deja indefinido cuál gana.
    if (seen.has(toolName)) {
      problems.push(
        `tools[${index}]: "${toolName}" está declarada más de una vez`,
      );
      continue;
    }
    seen.add(toolName);

    parsed.push({
      tool: toolName as KnownTool,
      permission: permissionName as ToolPermission,
    });
  }

  return parsed;
}

function parseMemoryConfig(
  raw: unknown,
  defaults: AgentConfiguration,
  problems: string[],
): AgentMemoryConfig {
  if (raw === undefined || raw === null) return defaults.memoryConfig;
  if (typeof raw !== 'object') {
    problems.push('`memoryConfig` debe ser un objeto');
    return defaults.memoryConfig;
  }

  const { strategy, windowSize } = raw as {
    strategy?: unknown;
    windowSize?: unknown;
  };

  const strategyName =
    strategy === undefined ? defaults.memoryConfig.strategy : asText(strategy);
  if (!(MEMORY_STRATEGIES as readonly string[]).includes(strategyName)) {
    problems.push(
      `estrategia de memoria inválida "${strategyName}". ` +
        `Válidas: ${MEMORY_STRATEGIES.join(', ')}`,
    );
  }

  let size = defaults.memoryConfig.windowSize;
  if (windowSize !== undefined) {
    const parsedSize = Number(windowSize);
    if (!Number.isInteger(parsedSize) || parsedSize < 1) {
      problems.push('`memoryConfig.windowSize` debe ser un entero mayor que 0');
    } else if (parsedSize > MAX_WINDOW_SIZE) {
      problems.push(
        `\`memoryConfig.windowSize\` no puede superar ${MAX_WINDOW_SIZE}: ` +
          'la memoria compite por el mismo presupuesto de contexto que el conocimiento',
      );
    } else {
      size = parsedSize;
    }
  }

  return { strategy: strategyName as MemoryStrategy, windowSize: size };
}

function parseGuardrails(
  raw: unknown,
  defaults: AgentConfiguration,
  problems: string[],
): AgentGuardrails {
  if (raw === undefined || raw === null) return defaults.guardrails;
  if (typeof raw !== 'object') {
    problems.push('`guardrails` debe ser un objeto');
    return defaults.guardrails;
  }

  const { forbiddenTopics, escalateToHumanWhen, maxToolCallsPerRun } = raw as {
    forbiddenTopics?: unknown;
    escalateToHumanWhen?: unknown;
    maxToolCallsPerRun?: unknown;
  };

  const stringList = (value: unknown, field: string): string[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      problems.push(`\`guardrails.${field}\` debe ser una lista de textos`);
      return [];
    }
    return value.map(asText).filter((item) => item.trim().length > 0);
  };

  let maxCalls = defaults.guardrails.maxToolCallsPerRun;
  if (maxToolCallsPerRun !== undefined) {
    const parsedMax = Number(maxToolCallsPerRun);
    if (!Number.isInteger(parsedMax) || parsedMax < 0) {
      problems.push(
        '`guardrails.maxToolCallsPerRun` debe ser un entero mayor o igual que 0',
      );
    } else if (parsedMax > MAX_TOOL_CALLS_CEILING) {
      problems.push(
        `\`guardrails.maxToolCallsPerRun\` no puede superar ${MAX_TOOL_CALLS_CEILING}`,
      );
    } else {
      maxCalls = parsedMax;
    }
  }

  return {
    forbiddenTopics: stringList(forbiddenTopics, 'forbiddenTopics'),
    escalateToHumanWhen: stringList(escalateToHumanWhen, 'escalateToHumanWhen'),
    maxToolCallsPerRun: maxCalls,
  };
}

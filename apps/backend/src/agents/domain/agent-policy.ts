import type {
  AgentConfiguration,
  KnownTool,
  ToolPermission,
} from './agent-configuration';

/**
 * Gate de políticas de agente — BUSINESSBRAIN_MIGRATION_PLAN.md §7.4,
 * `enforce-agent-policy.use-case.ts`.
 *
 * Decide si un agente puede ejecutar una herramienta concreta **antes** de ejecutarla.
 * Es dominio puro: sin base de datos, sin red, determinista. La misma configuración y la
 * misma acción producen siempre la misma decisión, y la decisión explica por qué.
 *
 * Tres reglas de fondo, en este orden:
 *
 * 1. **Falla cerrado.** Lo que no está explícitamente concedido está denegado. Una
 *    herramienta no declarada en el agente nunca se autoriza, aunque exista en la plataforma.
 * 2. **La declaración no puede superar lo que la plataforma permite.** Un agente puede
 *    declarar `AUTONOMOUS` en su configuración, pero si la plataforma no ejecuta ese nivel,
 *    se deniega igualmente. La configuración concede como mucho, nunca amplía.
 * 3. **El origen de la petición no la legitima.** Que la herramienta la pida el modelo —
 *    posiblemente influido por contenido ingerido— no añade ningún permiso.
 */

/**
 * Nivel máximo de permiso que la plataforma ejecuta HOY.
 *
 * Fase 5: solo `READ_ONLY`. Las herramientas con efectos se declaran, se validan y se
 * conservan en la configuración del agente, pero no se ejecutan. Es lo que cierra por
 * construcción la combinación peligrosa de datos privados + contenido ingerido no confiable
 * + acción externa: por muy convincente que sea una instrucción escondida en un documento,
 * no existe camino de código que envíe un email.
 */
export const MAX_EXECUTABLE_PERMISSION: ToolPermission = 'READ_ONLY';

const PERMISSION_RANK: Record<ToolPermission, number> = {
  READ_ONLY: 0,
  REQUIRES_CONFIRMATION: 1,
  AUTONOMOUS: 2,
};

export type PolicyDecision =
  | { allowed: true; tool: KnownTool; permission: ToolPermission }
  | { allowed: false; reason: PolicyDenialReason; explanation: string };

export type PolicyDenialReason =
  | 'AGENT_INACTIVE'
  | 'TOOL_NOT_GRANTED'
  | 'PERMISSION_NOT_EXECUTABLE'
  | 'TOOL_CALL_BUDGET_EXHAUSTED';

export interface PolicyRequest {
  configuration: AgentConfiguration;
  isActive: boolean;
  tool: string;
  /** Cuántas herramientas se han ejecutado ya en este turno. */
  toolCallsSoFar: number;
}

/**
 * Evalúa una petición de herramienta contra la configuración del agente.
 *
 * Nunca lanza: devolver una decisión explicada es parte del contrato, porque quien llama
 * necesita poder registrar POR QUÉ se denegó, no solo que se denegó.
 */
export function evaluateToolRequest(request: PolicyRequest): PolicyDecision {
  const { configuration, tool } = request;

  // Un agente desactivado no ejecuta nada, aunque su configuración siga siendo válida.
  if (!request.isActive) {
    return deny(
      'AGENT_INACTIVE',
      'El agente está desactivado y no puede ejecutar herramientas',
    );
  }

  const granted = configuration.tools.find((entry) => entry.tool === tool);
  if (!granted) {
    // Falla cerrado: existir en la plataforma no es haber sido concedida a este agente.
    return deny(
      'TOOL_NOT_GRANTED',
      `El agente no tiene concedida la herramienta "${tool}"`,
    );
  }

  if (
    PERMISSION_RANK[granted.permission] >
    PERMISSION_RANK[MAX_EXECUTABLE_PERMISSION]
  ) {
    // La configuración concede como mucho; nunca amplía lo que la plataforma ejecuta.
    return deny(
      'PERMISSION_NOT_EXECUTABLE',
      `"${tool}" está declarada como ${granted.permission}, y esta versión de la ` +
        `plataforma solo ejecuta herramientas ${MAX_EXECUTABLE_PERMISSION}`,
    );
  }

  // El tope acota el daño de un bucle: sin él, un agente influido por contenido malicioso
  // podría encadenar llamadas indefinidamente.
  if (request.toolCallsSoFar >= configuration.guardrails.maxToolCallsPerRun) {
    return deny(
      'TOOL_CALL_BUDGET_EXHAUSTED',
      `Se ha alcanzado el máximo de ${configuration.guardrails.maxToolCallsPerRun} ` +
        'herramientas por turno',
    );
  }

  return {
    allowed: true,
    tool: granted.tool,
    permission: granted.permission,
  };
}

function deny(
  reason: PolicyDenialReason,
  explanation: string,
): PolicyDecision & { allowed: false } {
  return { allowed: false, reason, explanation };
}

/**
 * Herramientas que este agente puede ejecutar realmente ahora mismo.
 *
 * Es lo que se ofrece al modelo. Anunciar una herramienta que el gate va a denegar produce
 * intentos condenados de antemano y respuestas peores: el modelo cree que puede hacer algo
 * que no puede.
 */
export function executableTools(
  configuration: AgentConfiguration,
): KnownTool[] {
  return configuration.tools
    .filter(
      (entry) =>
        PERMISSION_RANK[entry.permission] <=
        PERMISSION_RANK[MAX_EXECUTABLE_PERMISSION],
    )
    .map((entry) => entry.tool);
}

/**
 * Instrucción de guardrails que se antepone al prompt.
 *
 * Los guardrails NO son un mecanismo de seguridad por sí solos: un modelo puede ignorarlos.
 * Lo que de verdad impide una acción es `evaluateToolRequest`, que corre en código. Esto es
 * la capa de comportamiento, no la de control.
 */
export function guardrailDirective(configuration: AgentConfiguration): string {
  const { forbiddenTopics, escalateToHumanWhen } = configuration.guardrails;
  if (forbiddenTopics.length === 0 && escalateToHumanWhen.length === 0) {
    return '';
  }

  const lines: string[] = ['', 'Límites de actuación de este agente:'];
  if (forbiddenTopics.length > 0) {
    lines.push(
      `- No te pronuncies sobre: ${forbiddenTopics.join(', ')}. Si te preguntan, ` +
        'indica que ese asunto queda fuera de tu ámbito.',
    );
  }
  if (escalateToHumanWhen.length > 0) {
    lines.push(
      `- Pasa el turno a una persona cuando: ${escalateToHumanWhen.join('; ')}.`,
    );
  }

  return lines.join('\n');
}

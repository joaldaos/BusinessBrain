import type { KnownTool } from '../agent-configuration';

/** Token de inyección: el registro de herramientas se resuelve por token, no por clase. */
export const TOOL_REGISTRY = Symbol('ToolRegistry');

/**
 * Una herramienta ejecutable por un agente — BUSINESSBRAIN_MIGRATION_PLAN.md §7.4, `ToolPort`.
 *
 * **El alcance viaja en la ejecución, no en la herramienta.** Una herramienta no sabe de qué
 * organización es ni qué colecciones puede leer: se lo dicta quien la ejecuta, y quien la
 * ejecuta lo obtiene del agente. Si la herramienta guardara ese estado, dos turnos de
 * agentes distintos podrían pisarse.
 *
 * Toda herramienta declarada aquí es de SOLO LECTURA. Las que tienen efectos fuera del
 * sistema no se implementan en la Fase 5: no basta con que el gate las deniegue, es que no
 * existe el código que las ejecutaría.
 */
export interface ToolExecutionScope {
  organizationId: string;
  userId: string;
  /**
   * Colecciones del agente. Obligatorio y no vacío: una herramienta de lectura sin acotar
   * leería toda la organización, que es exactamente la fuga que el alcance evita.
   */
  allowedCollectionIds: string[];
}

export interface ToolResult {
  /** Texto que se devuelve al modelo. Son DATOS, nunca instrucciones. */
  content: string;
  /** Referencias para citar, si la herramienta las produce. */
  citations?: { knowledgeItemId: string; chunkId: string; label: string }[];
}

export interface ToolPort {
  readonly key: KnownTool;
  /** Qué hace, para poder describirla al modelo sin duplicar el texto en otro sitio. */
  readonly description: string;
  execute(input: string, scope: ToolExecutionScope): Promise<ToolResult>;
}

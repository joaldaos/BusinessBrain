/**
 * Clasificación obligatoria activo/terminal del ciclo de vida de un Insight.
 *
 * UNDERSTANDING_ENGINE_DESIGN.md §5
 *
 * Este enum describe ÚNICAMENTE el estatus epistémico de una conclusión — qué sabemos de su
 * validez — y NUNCA la frescura de su cómputo. La frescura es `EvidenceFreshness`, una
 * proyección derivada en lectura (§3.4) que deliberadamente no se persiste: por eso no
 * existe un estado `OBSOLETE`. Un estado nuevo que describa frescura en vez de estatus
 * epistémico no pertenece a este enum y debe rechazarse.
 *
 * Todo estado nuevo debe clasificarse aquí explícitamente. La ausencia de clasificación
 * NUNCA se resuelve por omisión: hace fallar el test de contrato en CI.
 */
import { InsightStatus } from '@prisma/client';

/**
 * Estados terminales: la conclusión ha dejado de representar comprensión viva. Conjunto
 * CERRADO y estable — es el que usa el índice parcial de idempotencia (§12), definido por
 * exclusión de estos y no por inclusión de los activos, para fallar del lado seguro ante un
 * estado futuro todavía sin clasificar.
 */
export const TERMINAL_INSIGHT_STATUSES = [
  InsightStatus.SUPERSEDED,
  InsightStatus.DISCARDED,
  InsightStatus.EXPIRED,
] as const satisfies readonly InsightStatus[];

/**
 * Estados activos. `CANDIDATE` aún no es conocimiento vivo (no persistido como tal);
 * `ACTIVE` es el único estado activo persistido.
 */
export const ACTIVE_INSIGHT_STATUSES = [
  InsightStatus.CANDIDATE,
  InsightStatus.ACTIVE,
] as const satisfies readonly InsightStatus[];

export type TerminalInsightStatus = (typeof TERMINAL_INSIGHT_STATUSES)[number];

export function isTerminalInsightStatus(status: InsightStatus): boolean {
  return (TERMINAL_INSIGHT_STATUSES as readonly InsightStatus[]).includes(
    status,
  );
}

/**
 * Tipos de Insight que exigen un BusinessObjective en estado CONFIRMED vinculado mediante
 * InsightObjectiveLink — §8. Todo tipo nuevo debe declarar explícitamente si lo exige;
 * igual que arriba, la omisión hace fallar el test de contrato, nunca se resuelve por defecto.
 */
export const TYPES_REQUIRING_BUSINESS_OBJECTIVE = [
  'RISK',
  'OPPORTUNITY',
] as const;

export function requiresBusinessObjective(type: string): boolean {
  return (TYPES_REQUIRING_BUSINESS_OBJECTIVE as readonly string[]).includes(
    type,
  );
}

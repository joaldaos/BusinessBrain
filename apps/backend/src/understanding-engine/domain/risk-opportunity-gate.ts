import { InsightType } from '@businessbrain/database';
import { requiresBusinessObjective } from './insight-status.classification';

/**
 * Gate de Riesgo/Oportunidad — UNDERSTANDING_ENGINE_DESIGN.md §8.
 *
 * Regla arquitectónica central del dominio: **ningún `Insight` de tipo `RISK` u
 * `OPPORTUNITY` puede persistirse sin al menos un `BusinessObjective` en estado
 * `CONFIRMED` vinculado** mediante `InsightObjectiveLink` — nunca como evidencia.
 *
 * El gate es DETERMINISTA y de responsabilidad única: valida el requisito de negocio y, si
 * no se cumple, aplica la degradación que la estrategia declaró. No decide ni reinterpreta
 * a qué tipo degradar — esa es una decisión semántica que pertenece exclusivamente a quien
 * generó el razonamiento, porque solo él conoce el contexto que la justifica.
 *
 * Se aplica en el pipeline, no como convención de las estrategias: ninguna estrategia,
 * presente o futura, puede saltárselo.
 */

export interface GateInput {
  type: InsightType;
  /** Tipo al que degradar si el requisito no se cumple. Obligatorio para RISK/OPPORTUNITY. */
  degradesTo?: Extract<InsightType, 'PATTERN' | 'ANOMALY'>;
  /** Objetivos CONFIRMADOS y vigentes que la estrategia propone como ancla. */
  confirmedObjectiveIds: string[];
}

export interface GateDecision {
  /** Tipo con el que el candidato debe persistirse. */
  resolvedType: InsightType;
  degraded: boolean;
  /** Objetivos que deben vincularse mediante `InsightObjectiveLink`. Vacío si se degradó. */
  objectiveIdsToLink: string[];
  rationale: string;
}

export function applyRiskOpportunityGate(input: GateInput): GateDecision {
  // Un tipo que no expresa juicio de valor pasa sin evaluación: una observación no necesita
  // ancla de negocio (§7). Si un tipo futuro se añade al enum sin declarar si la exige, el
  // test de contrato de la clasificación falla en CI antes de llegar aquí.
  if (!requiresBusinessObjective(input.type)) {
    return {
      resolvedType: input.type,
      degraded: false,
      objectiveIdsToLink: [],
      rationale:
        'Observación sin juicio de valor: no requiere ancla de negocio (§7)',
    };
  }

  if (input.confirmedObjectiveIds.length > 0) {
    return {
      resolvedType: input.type,
      degraded: false,
      objectiveIdsToLink: input.confirmedObjectiveIds,
      rationale:
        `Anclado a ${input.confirmedObjectiveIds.length} objetivo(s) de negocio ` +
        `confirmado(s): el juicio de valor está justificado`,
    };
  }

  if (!input.degradesTo) {
    // El contrato del puerto lo exige (§13). Sin él, el gate no puede aplicar la
    // degradación sin inventar una decisión semántica que no le corresponde: se rechaza
    // el candidato de forma explícita en vez de elegir un tipo por su cuenta.
    throw new Error(
      `Un candidato de tipo ${input.type} debe declarar su tipo de degradación (§13): ` +
        `el gate aplica la decisión de la estrategia, nunca la toma por ella`,
    );
  }

  return {
    resolvedType: input.degradesTo,
    degraded: true,
    objectiveIdsToLink: [],
    rationale:
      `Sin BusinessObjective CONFIRMADO que lo sostenga: degradado de ${input.type} a ` +
      `${input.degradesTo} según declaró la estrategia. No se descarta la información, ` +
      `se despoja del juicio de valor que no puede justificar (§8)`,
  };
}

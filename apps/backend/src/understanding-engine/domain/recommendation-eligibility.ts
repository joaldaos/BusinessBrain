import { InsightStatus, InsightType } from '@businessbrain/database';

/**
 * Cuándo una conclusión merece convertirse en una propuesta — dominio puro.
 *
 * ## Por qué esta regla existe y es estricta
 *
 * Es preferible CERO recomendaciones a una recomendación falsa. Una propuesta sin fundamento
 * no es un fallo cosmético: una PYME que la lea y actúe está tomando una decisión de negocio
 * sobre algo que el sistema no sabía. Y una sola propuesta inventada destruye la confianza en
 * todas las demás, incluidas las buenas.
 *
 * Por eso la regla es una puerta, no una sugerencia: lo que no la pasa no genera nada, y el
 * motivo queda dicho para poder explicarlo.
 *
 * ## Qué NO decide esta regla
 *
 * No decide si la propuesta es acertada — eso lo decide una persona al aceptarla o
 * descartarla. Decide únicamente si hay MATERIAL suficiente para que proponer algo sea
 * honesto.
 *
 * Sin base de datos, sin red, determinista.
 */

/**
 * Confianza mínima de la conclusión.
 *
 * Por debajo, el propio motor está diciendo que no las tiene todas consigo. Proponer una
 * acción sobre eso sería presentar como criterio lo que es una corazonada.
 */
export const MINIMUM_CONFIDENCE = 0.6;

/**
 * Piezas de evidencia mínimas.
 *
 * UNA. La línea que no se puede cruzar es proponer sobre CERO evidencia: eso es inventar.
 *
 * Exigir dos fue el primer intento y silenciaba justo lo más útil que el sistema sabe decirle a
 * una PYME. La estrategia determinista produce anomalías sobre UN documento —"este contrato ha
 * perdido fiabilidad", "esto ya no está en su origen"— y para una afirmación sobre un
 * documento, ese documento ES la evidencia completa. Pedir corroboración ahí confunde dos cosas
 * distintas: corroborar hace falta al inferir un hecho de negocio de varias fuentes, no al
 * señalar algo de una.
 *
 * La segunda puerta sigue protegiendo de la invención: sin contrato completo no se publica nada.
 */
export const MINIMUM_EVIDENCE = 1;

export type IneligibilityReason =
  | 'ESTADO_NO_ACTIVO'
  | 'TIPO_NO_ACCIONABLE'
  | 'EVIDENCIA_INSUFICIENTE'
  | 'CONFIANZA_INSUFICIENTE'
  | 'SIN_ALCANCE'
  | 'YA_PROPUESTA';

export interface EligibilityDecision {
  eligible: boolean;
  reason?: IneligibilityReason;
  /** Por qué no, en lenguaje de negocio. Se registra para poder explicarlo después. */
  explanation?: string;
}

export interface EligibilityInput {
  status: InsightStatus;
  type: InsightType;
  confidence: number;
  /** Piezas del cierre transitivo de evidencia. */
  evidenceCount: number;
  /** Colecciones que sostienen la conclusión. Vacío = nadie podría verla. */
  effectiveCollectionScope: string[];
  /** Ya existe una propuesta viva para esta conclusión. */
  alreadyProposed: boolean;
}

/**
 * Tipos que articulan una acción.
 *
 * Una `ANOMALY` es una DESVIACIÓN respecto de lo esperado —conocimiento que perdió fiabilidad,
 * que quedó obsoleto, que se contradice— y sobre una desviación siempre cabe la acción honesta
 * de revisarla o corregirla. `RISK` y `OPPORTUNITY` van además anclados a un objetivo de
 * negocio (§8), que permite decir qué mejoraría actuar.
 *
 * Un `PATTERN`, en cambio, solo dice "esto se repite". No hay nada desalineado, así que
 * proponer "haz algo" obligaría a inventarse el algo.
 *
 * Excluir `ANOMALY` fue el primer intento y era un error de producto, no de criterio: la única
 * estrategia DETERMINISTA del motor produce exclusivamente anomalías —`RISK` y `OPPORTUNITY`
 * exigen razonamiento generativo y un objetivo ya confirmado—, así que la regla dejaba la
 * funcionalidad inalcanzable justo por el camino que siempre funciona.
 *
 * La segunda puerta sigue protegiendo: si sobre esa anomalía no hay nada que proponer, el
 * modelo responde que no y no se crea nada.
 */
const ACTIONABLE_TYPES: readonly InsightType[] = [
  InsightType.RISK,
  InsightType.OPPORTUNITY,
  InsightType.ANOMALY,
];

export function evaluateEligibility(
  input: EligibilityInput,
): EligibilityDecision {
  // El orden importa: se comprueba primero lo que hace la conclusión inservible del todo, y
  // después lo que la hace insuficiente. Así el motivo que se registra es el más específico.
  if (input.alreadyProposed) {
    return {
      eligible: false,
      reason: 'YA_PROPUESTA',
      explanation:
        'Ya existe una propuesta pendiente para esta conclusión: no se duplica.',
    };
  }

  if (input.status !== InsightStatus.ACTIVE) {
    // Superada, descartada o expirada: la afirmación ya no representa lo que sabemos. Una
    // propuesta sobre conocimiento obsoleto es peor que ninguna, porque parece vigente.
    return {
      eligible: false,
      reason: 'ESTADO_NO_ACTIVO',
      explanation:
        'La conclusión ya no está vigente, así que no se propone nada sobre ella.',
    };
  }

  if (!ACTIONABLE_TYPES.includes(input.type)) {
    return {
      eligible: false,
      reason: 'TIPO_NO_ACCIONABLE',
      explanation:
        'Es una observación, no algo sobre lo que quepa proponer una acción concreta.',
    };
  }

  if (input.effectiveCollectionScope.length === 0) {
    // Fail-closed. Sin alcance nadie podría leerla, y una propuesta invisible es ruido en la
    // base de datos que además nadie puede auditar.
    return {
      eligible: false,
      reason: 'SIN_ALCANCE',
      explanation:
        'La evidencia que la sostiene no pertenece a ninguna colección, así que nadie ' +
        'podría consultarla.',
    };
  }

  if (input.evidenceCount < MINIMUM_EVIDENCE) {
    return {
      eligible: false,
      reason: 'EVIDENCIA_INSUFICIENTE',
      explanation:
        'No hay evidencia suficiente para proponer una acción: hace falta más de un ' +
        'documento que lo respalde.',
    };
  }

  if (input.confidence < MINIMUM_CONFIDENCE) {
    return {
      eligible: false,
      reason: 'CONFIANZA_INSUFICIENTE',
      explanation:
        'La confianza en esta conclusión es demasiado baja para proponer una acción.',
    };
  }

  return { eligible: true };
}

/**
 * Lo que el modelo tiene que devolver para que la propuesta sea publicable.
 *
 * Se comprueba campo a campo porque un proveedor que responde a medias es el caso NORMAL, no
 * la excepción: se queda sin contexto, corta la respuesta o devuelve una plantilla vacía. Una
 * propuesta con la mitad de los apartados en blanco no cumple el contrato de Evolución
 * Asistida y no debe llegar a la pantalla.
 */
export interface ProposalDraft {
  title: string;
  detected: string;
  justification: string;
  estimatedImpact: string;
  advantages: string;
  drawbacks: string;
  affectedAreas: string;
  migrationPlan: string;
}

/** Mínimo por apartado. Un "sí", un "n/a" o una palabra suelta no explican nada. */
const MINIMUM_FIELD_LENGTH = 12;

export function isPublishableProposal(
  draft: Partial<ProposalDraft> | null | undefined,
): draft is ProposalDraft {
  if (!draft) return false;

  const required: (keyof ProposalDraft)[] = [
    'title',
    'detected',
    'justification',
    'estimatedImpact',
    'advantages',
    'drawbacks',
    'affectedAreas',
    'migrationPlan',
  ];

  return required.every((field) => {
    const value = draft[field];
    return (
      typeof value === 'string' && value.trim().length >= MINIMUM_FIELD_LENGTH
    );
  });
}

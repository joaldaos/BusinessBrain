/**
 * Vocabulario canónico de identidad de sujeto — UNDERSTANDING_ENGINE_DESIGN.md §3.4, §13.
 * Fase 7.2.
 *
 * ## Qué estaba roto
 *
 * §13 dice que una estrategia **propone** la identidad y **el dominio resuelve**, mediante
 * una *regla de derivación compartida*, y que **ninguna estrategia puede acuñar identidad de
 * dominio por su cuenta**. El código hacía lo contrario: cada estrategia componía la cadena
 * final y el dominio la aceptaba literal. La simbólica escribía
 * `confidence-decay:knowledge-item:<id>`; la generativa, `generative-synthesis:<prosa del
 * modelo>`. Sus vocabularios no se cruzaban jamás, así que la corroboración entre estrategias
 * que §9 describe era estructuralmente imposible, y la generativa se contradecía a sí misma
 * según cómo redactase el modelo.
 *
 * ## La identidad es el REFERENTE y el ASPECTO
 *
 * `<tipoDeReferente>:<idDelReferente>#<aspecto>`
 *
 * De qué se está hablando y qué dimensión suya se observa. Nunca quién lo observó, nunca qué
 * se concluyó.
 *
 * - **Fuera la clave de estrategia**: es el observador. Incluirla es exactamente lo que hacía
 *   imposible que dos mecanismos hablaran del mismo asunto.
 * - **Fuera el tipo** (§3.4, literal): un `ANOMALY` que pasa a `RISK` al aparecer un objetivo
 *   confirmado (§8) es continuidad, no un sujeto nuevo.
 * - **Fuera el texto libre**: la prosa de un modelo no es estable entre ejecuciones.
 * - **Fuera la similitud semántica** (§9): la corroboración se decide sobre identidad
 *   compartida, "nunca sobre una equivalencia estimada caso a caso".
 *
 * El **aspecto** es lo que impide que todo lo que se afirme sobre un documento colapse en un
 * único sujeto y que creencias distintas se supersedan entre sí en bucle.
 *
 * ## Asimetría obligatoria de fallo seguro (§3.4)
 *
 * Ante cualquier duda, sujeto NUEVO; jamás fusionar. Fusionar por error produce una
 * supersesión falsa —un `Insight` reemplazando en silencio a otro que no le corresponde—,
 * daño grave y difícil de detectar. Separar por error solo produce duplicados, recuperables
 * mediante curación humana (§3.7).
 *
 * Dominio puro: sin base de datos, sin red, determinista. La comprobación de que el referente
 * existe y pertenece a la organización la hace la capa de aplicación, que es quien puede.
 */

/**
 * Entidades sobre las que el sistema puede afirmar algo con identidad estable.
 *
 * Catálogo CERRADO y propiedad del dominio. Una estrategia no puede ampliarlo: si pudiera,
 * volvería a acuñar identidad por su cuenta por otra vía.
 */
export const SUBJECT_REFERENT_TYPES = [
  'knowledge-item',
  'knowledge-source',
  'canonical-entity',
  'knowledge-collection',
  'business-objective',
] as const;

export type SubjectReferentType = (typeof SUBJECT_REFERENT_TYPES)[number];

/**
 * Dimensión observada del referente.
 *
 * Catálogo CERRADO. Es el discriminador que evita el "imán de sujeto": sin él, «la confianza
 * de este documento ha caído» y «este documento contradice la política de márgenes» serían
 * el mismo asunto y se reemplazarían mutuamente sin parar.
 */
export const SUBJECT_ASPECTS = [
  /** Cuánto se puede confiar en el referente como fuente. */
  'confianza',
  /** Si lo que dice es consistente consigo mismo y con el resto del conocimiento. */
  'coherencia',
  /** Si sigue estando al día. */
  'vigencia',
  /** Si el referente es alcanzable y está operativo. */
  'disponibilidad',
  /** Si el conocimiento sobre el referente está completo. */
  'cobertura',
] as const;

export type SubjectAspect = (typeof SUBJECT_ASPECTS)[number];

/**
 * Lo que una estrategia PROPONE. No es una identidad todavía.
 *
 * `novel` es la abstención explícita: la estrategia declara que no puede derivar un referente
 * único con certeza. Es una respuesta legítima y obligatoria, no un fallo — §13 la exige
 * ("o una nueva en cualquier otro caso").
 */
export type SubjectProposal =
  | {
      novel?: false;
      referentType: SubjectReferentType;
      referentId: string;
      aspect: SubjectAspect;
    }
  | { novel: true };

export type SubjectResolutionReason =
  /** Deriva de un referente concreto que la estrategia identificó con certeza. */
  | 'DERIVED'
  /** La estrategia se abstuvo: no podía derivar un referente único. */
  | 'ABSTAINED'
  /** La propuesta no era válida. Se acuña sujeto nuevo, nunca se aproxima a uno existente. */
  | 'INVALID_PROPOSAL';

export interface ResolvedSubjectIdentity {
  value: string;
  reason: SubjectResolutionReason;
  /** Presente solo cuando deriva de un referente real. */
  referent?: {
    type: SubjectReferentType;
    id: string;
    aspect: SubjectAspect;
  };
}

const REFERENT_TYPES = new Set<string>(SUBJECT_REFERENT_TYPES);
const ASPECTS = new Set<string>(SUBJECT_ASPECTS);

/** Prefijo de los sujetos opacos. No es un referente: es la ausencia deliberada de uno. */
export const NOVEL_SUBJECT_PREFIX = 'sujeto-nuevo';

export function isNovelSubject(subjectIdentity: string): boolean {
  return subjectIdentity.startsWith(`${NOVEL_SUBJECT_PREFIX}:`);
}

/**
 * Acuña la identidad canónica de un referente.
 *
 * Es la única forma válida de construir la cadena: nadie la compone concatenando a mano.
 */
export function subjectIdentityOf(params: {
  referentType: SubjectReferentType;
  referentId: string;
  aspect: SubjectAspect;
}): string {
  return `${params.referentType}:${params.referentId}#${params.aspect}`;
}

/**
 * Lee una identidad canónica. Devuelve `null` si no lo es.
 *
 * Las identidades históricas, anteriores a este vocabulario, no parsean — y no pasa nada:
 * son historia y permanecen intactas. Nada del sistema depende de poder interpretarlas; la
 * cadena de versiones la da `supersedesInsightId`, no la forma de la cadena de texto.
 */
export function parseSubjectIdentity(value: string): {
  referentType: SubjectReferentType;
  referentId: string;
  aspect: SubjectAspect;
} | null {
  const hash = value.lastIndexOf('#');
  if (hash <= 0) return null;

  const aspect = value.slice(hash + 1);
  if (!ASPECTS.has(aspect)) return null;

  const head = value.slice(0, hash);
  const colon = head.indexOf(':');
  if (colon <= 0) return null;

  const referentType = head.slice(0, colon);
  const referentId = head.slice(colon + 1);
  if (!REFERENT_TYPES.has(referentType) || referentId.length === 0) return null;

  return {
    referentType: referentType as SubjectReferentType,
    referentId,
    aspect: aspect as SubjectAspect,
  };
}

/**
 * Valida la forma de una propuesta. No comprueba que el referente exista: eso exige base de
 * datos y lo hace la aplicación.
 *
 * Cualquier propuesta que no encaje se trata como abstención. Nunca se corrige ni se
 * aproxima: aproximar es fusionar, y fusionar mal es el daño que §3.4 prohíbe.
 */
export function validateSubjectProposal(
  proposal: SubjectProposal | null | undefined,
):
  | {
      valid: true;
      referentType: SubjectReferentType;
      referentId: string;
      aspect: SubjectAspect;
    }
  | { valid: false; reason: SubjectResolutionReason } {
  if (!proposal) return { valid: false, reason: 'INVALID_PROPOSAL' };
  if (proposal.novel === true) return { valid: false, reason: 'ABSTAINED' };

  const { referentType, referentId, aspect } = proposal;
  if (
    typeof referentId !== 'string' ||
    referentId.trim().length === 0 ||
    !REFERENT_TYPES.has(referentType) ||
    !ASPECTS.has(aspect)
  ) {
    return { valid: false, reason: 'INVALID_PROPOSAL' };
  }

  return { valid: true, referentType, referentId: referentId.trim(), aspect };
}

/**
 * Deriva el referente de un conjunto de evidencias citadas.
 *
 * Regla: si TODAS resuelven al mismo referente, ése es. Si abarcan varios, la estrategia no
 * puede derivar uno con certeza y debe abstenerse. Es la regla que permite a una estrategia
 * generativa anclar su identidad a lo que realmente citó en vez de a la prosa que produjo —
 * y abstenerse cuando su razonamiento cruza varias fuentes.
 */
export function deriveSingleReferent(
  referentIds: string[],
): { referentId: string } | null {
  const unique = [...new Set(referentIds.filter((id) => id.length > 0))];
  return unique.length === 1 ? { referentId: unique[0] } : null;
}

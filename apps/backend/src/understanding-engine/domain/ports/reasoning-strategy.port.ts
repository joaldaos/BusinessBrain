/**
 * Contrato que toda estrategia de razonamiento debe cumplir.
 *
 * UNDERSTANDING_ENGINE_DESIGN.md §6, §13
 *
 * Una estrategia PROPONE candidatos; nunca decide si se persisten. Eso lo deciden
 * `ResolveInsightConflict` y `ApplyRiskOpportunityGate`, fuera del puerto.
 */
import { InsightType } from '@prisma/client';
import { KnowledgeSignal } from './knowledge-signals.port';
import type { SubjectProposal } from '../subject-identity';

/**
 * Categoría del mecanismo. El dominio no distingue entre ellas más allá de su factor de
 * fiabilidad declarado (§3.2); determina qué constituye una traza válida (§10).
 */
export type ReasoningStrategyKind = 'DETERMINISTIC' | 'SYMBOLIC' | 'GENERATIVE';

/** Rol que juega una evidencia propuesta en el razonamiento (§3.5). */
export type ProposedEvidenceRole =
  'BASELINE' | 'DEVIATION' | 'CORROBORATION' | 'CONTRADICTION';

export interface ProposedEvidence {
  kind:
    | 'KNOWLEDGE_ITEM'
    | 'KNOWLEDGE_CHUNK'
    | 'CANONICAL_ENTITY'
    | 'DERIVED_INSIGHT';
  role: ProposedEvidenceRole;
  /**
   * Referencia a la pieza de evidencia. Si es `DERIVED_INSIGHT` debe apuntar a un Insight
   * YA PERSISTIDO — nunca a un candidato de la misma ejecución: es lo que garantiza que el
   * grafo de evidencia sea acíclico por construcción (§3.5).
   */
  refId: string;
}

export interface InsightCandidate {
  /**
   * Identidad de sujeto que la estrategia RECONOCE (§3.4, §13). Una PROPUESTA, no la
   * identidad: la estrategia propone y el dominio resuelve (`SubjectIdentityService`).
   *
   * Se declara como referente + aspecto —de qué se habla y qué dimensión suya se observa—,
   * nunca como una cadena ya compuesta: si la estrategia compusiera la cadena final estaría
   * acuñando identidad de dominio por su cuenta, que es justo lo que §13 prohíbe.
   *
   * ANTE DUDA, ABSTENERSE (`{ novel: true }`) — jamás asignar a un referente por
   * aproximación. Fusionar por error produce una supersesión falsa (un Insight reemplazando
   * en silencio a otro que no le corresponde); separar por error solo produce duplicados,
   * recuperables mediante curación humana.
   *
   * El tipo NUNCA forma parte de la identidad: un mismo sujeto pasa de ANOMALY a RISK
   * cuando aparece un BusinessObjective confirmado que lo hace relevante (§8).
   */
  subjectProposal: SubjectProposal;
  type: InsightType;
  summary: string;
  evidence: ProposedEvidence[];
  /** Confianza cruda de la fuente, antes de componerla con la fiabilidad de la estrategia (§9). */
  rawConfidence: number;
  /** Traza estructurada, obligatoria, nunca texto libre sin estructura (§10). */
  reasoningTrace: Record<string, unknown>;
  /**
   * Tipo al que degradar si `ApplyRiskOpportunityGate` rechaza el candidato por ausencia de
   * un BusinessObjective confirmado (§8). Obligatorio para RISK/OPPORTUNITY.
   *
   * Lo declara la estrategia, NUNCA el gate: solo quien generó el razonamiento conoce el
   * contexto que justifica a qué tipo degradar. El gate se limita a aplicarlo, permaneciendo
   * determinista y de responsabilidad única.
   */
  degradesTo?: Extract<InsightType, 'PATTERN' | 'ANOMALY'>;
}

/** Contexto acotado que recibe una estrategia (§13). */
export interface ReasoningContext {
  organizationId: string;
  signals: KnowledgeSignal[];
}

export const REASONING_STRATEGY = Symbol('REASONING_STRATEGY');

export interface ReasoningStrategyPort {
  readonly key: string;
  readonly version: string;
  readonly kind: ReasoningStrategyKind;
  /** Factor de fiabilidad base usado al componer la confianza (§9). */
  readonly baseReliability: number;
  /** Tipos que esta estrategia puede producir (§3.2). */
  readonly producibleTypes: InsightType[];

  generate(context: ReasoningContext): Promise<InsightCandidate[]>;
}

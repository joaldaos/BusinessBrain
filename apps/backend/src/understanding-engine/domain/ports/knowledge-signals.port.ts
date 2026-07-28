/**
 * Contrato de lectura de las señales operativas que el Knowledge Engine expone.
 *
 * UNDERSTANDING_ENGINE_DESIGN.md §13 · KNOWLEDGE_ENGINE_DESIGN.md §1.4, §13.1
 *
 * Es un contrato DISTINTO del Retriever: estas señales no son `KnowledgeChunk`, sino
 * metadatos de `KnowledgeSource` / `Canonical Knowledge Entity` / `KnowledgeItem`. Por eso
 * consumirlas no viola la regla de que el Retriever es el único camino al contenido.
 *
 * Entrega HECHOS, nunca veredictos. Qué cambio invalida qué comprensión es epistemología y
 * pertenece en exclusiva a este dominio: si el Knowledge Engine emitiera ese juicio,
 * necesitaría conocer entidades de un dominio superior e invertiría la dependencia.
 */

/** Naturaleza de la señal. Refleja 1:1 lo que KNOWLEDGE_ENGINE_DESIGN.md §1.4 declara exponer. */
export type KnowledgeSignalKind =
  /** Confianza de un KnowledgeItem por debajo del umbral configurado (KE §8.3). */
  | 'CONFIDENCE_DECAYED'
  /** Canonical Knowledge Entity en conflicto, sin resolver (KE §10). */
  | 'CANONICALIZATION_UNRESOLVED'
  /** KnowledgeSource en estado ERROR o DESHABILITADA (KE §3.2, §5). */
  | 'SOURCE_DISCONNECTED';

/** Entidad del Knowledge Engine que originó la señal. */
export type KnowledgeSignalSubjectKind =
  'KNOWLEDGE_ITEM' | 'KNOWLEDGE_SOURCE' | 'CANONICAL_ENTITY';

export interface KnowledgeSignal {
  kind: KnowledgeSignalKind;
  subjectKind: KnowledgeSignalSubjectKind;
  /** Identificador de la entidad de origen — base de la trazabilidad del Insight (§10). */
  subjectId: string;
  /** Cuándo pasó a ser cierta la señal. */
  observedAt: Date;
  /**
   * Datos objetivos que acompañan a la señal (p. ej. el valor de confianza y el umbral que
   * cruzó). Hechos medibles, nunca una interpretación de su relevancia.
   */
  facts: Record<string, unknown>;
}

export interface KnowledgeSignalsQuery {
  /** Obligatorio y no negociable: ninguna consulta cruza la frontera de una organización. */
  organizationId: string;
  kinds?: KnowledgeSignalKind[];
  /** Acota a señales observadas a partir de este instante. */
  since?: Date;
}

export const KNOWLEDGE_SIGNALS_PORT = Symbol('KNOWLEDGE_SIGNALS_PORT');

export interface KnowledgeSignalsPort {
  listSignals(query: KnowledgeSignalsQuery): Promise<KnowledgeSignal[]>;
}

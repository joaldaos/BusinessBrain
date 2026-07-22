export interface SemanticDuplicateCandidate {
  knowledgeItemId: string;
  similarity: number;
}

export interface FindSemanticDuplicateCandidatesParams {
  organizationId: string;
  contentText: string;
  /** El nivel 3 opera exclusivamente entre KnowledgeSource distintas (KNOWLEDGE_ENGINE_DESIGN.md §7, "Frontera con el linaje de versiones"). */
  excludeKnowledgeSourceId: string;
}

/**
 * Nivel 3 de deduplicación (KNOWLEDGE_ENGINE_DESIGN.md §7): similitud semántica entre
 * KnowledgeSource distintas, candidato a canonicalización (§10). Interfaz/puerto preparado, sin
 * lógica de comparación real todavía — depende de embeddings a nivel de documento (subfase 2.6) y
 * de `Canonical Knowledge Entity` (subfase 2.5), ninguna disponible en la subfase 2.2 (Revisión
 * formal — Subfase 2.2, hallazgo C). Puede tener candidatos reales desde ya en Fase 2 (varias
 * KnowledgeSource con contenido solapado, hallazgo B) — lo que falta no es el dato, es la
 * capacidad de compararlo.
 */
export interface SemanticDeduplicationPort {
  findCandidates(
    params: FindSemanticDuplicateCandidatesParams,
  ): Promise<SemanticDuplicateCandidate[]>;
}

/** Implementación no-operativa de SemanticDeduplicationPort — ver documentación de la interfaz. */
export class NoopSemanticDeduplication implements SemanticDeduplicationPort {
  findCandidates(): Promise<SemanticDuplicateCandidate[]> {
    return Promise.resolve([]);
  }
}

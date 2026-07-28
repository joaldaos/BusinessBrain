/**
 * Acceso del Understanding Engine al Retriever del Knowledge Engine.
 *
 * UNDERSTANDING_ENGINE_DESIGN.md §13 · KNOWLEDGE_ENGINE_DESIGN.md §13
 *
 * El Understanding Engine consume el Retriever DIRECTAMENTE, nunca el Context Builder
 * (§14 de ese documento): el Context Builder resuelve un problema específico de
 * conversación —presupuesto de turno, ensamblado con historial y system prompt— que no
 * aplica a un razonamiento por lotes sin conversación. Reutilizarlo acoplaría este dominio
 * a una superficie de consumo que ni siquiera existe todavía.
 *
 * Cuando una estrategia generativa necesita acotar su propio contexto para una llamada a un
 * LLM, lo hace como parte de su implementación, no reutilizando el Context Builder de chat.
 */

export interface RetrievedKnowledge {
  chunkId: string;
  content: string;
  knowledgeItemId: string;
  title: string;
  chunkIndex: number;
  heading: string | null;
  headingPath: string[];
  confidenceScore: number;
}

export interface KnowledgeRetrievalQuery {
  /** Obligatorio y no negociable, igual que en el Retriever. */
  organizationId: string;
  query: string;
  limit?: number;
}

export const KNOWLEDGE_RETRIEVAL_PORT = Symbol('KNOWLEDGE_RETRIEVAL_PORT');

export interface KnowledgeRetrievalPort {
  retrieve(query: KnowledgeRetrievalQuery): Promise<RetrievedKnowledge[]>;
}

import { Injectable } from '@nestjs/common';
import { RetrieveContextUseCase } from '../../knowledge-engine/application/retrieve-context.use-case';
import {
  ORGANIZATION_WIDE_REASONS,
  organizationWideScope,
} from '../../knowledge-engine/domain/knowledge-scope';
import type {
  KnowledgeRetrievalPort,
  KnowledgeRetrievalQuery,
  RetrievedKnowledge,
} from '../domain/ports/knowledge-retrieval.port';

/**
 * Implementación de `KnowledgeRetrievalPort` sobre el Retriever del Knowledge Engine.
 *
 * Delega íntegramente en `RetrieveContextUseCase`: no reimplementa ningún filtro ni relaja
 * ninguna garantía. El aislamiento por organización, el piso de confianza y el filtro de
 * estado y canonicidad son responsabilidad del Retriever y se heredan tal cual.
 */
@Injectable()
export class RetrieverKnowledgeRetrievalAdapter implements KnowledgeRetrievalPort {
  constructor(private readonly retrieveContext: RetrieveContextUseCase) {}

  async retrieve(
    query: KnowledgeRetrievalQuery,
  ): Promise<RetrievedKnowledge[]> {
    const results = await this.retrieveContext.execute({
      organizationId: query.organizationId,
      query: query.query,
      limit: query.limit,
      // ÚNICO uso legítimo de organización completa: el razonamiento analiza todo el
      // conocimiento de la empresa (§3.4). Acotarlo por persona dejaría a la organización
      // con conclusiones distintas según quién lanzara la ejecución. El alcance por persona
      // se aplica al LEER la comprensión, no al producirla.
      scope: organizationWideScope(
        ORGANIZATION_WIDE_REASONS.ANALYSIS_REASONING,
      ),
    });

    return results.map((result) => ({
      chunkId: result.chunkId,
      content: result.content,
      knowledgeItemId: result.citation.knowledgeItemId,
      title: result.citation.title,
      chunkIndex: result.citation.chunkIndex,
      heading: result.citation.heading,
      headingPath: result.citation.headingPath,
      confidenceScore: result.confidenceScore,
    }));
  }
}

import { Injectable } from '@nestjs/common';
import { RetrieveContextUseCase } from '../../../knowledge-engine/application/retrieve-context.use-case';
import { citationLabel } from '../../../knowledge-engine/domain/context-builder';
import type { KnownTool } from '../../domain/agent-configuration';
import type {
  ToolExecutionScope,
  ToolPort,
  ToolResult,
} from '../../domain/ports/tool.port';

/** Cuántos fragmentos devuelve una búsqueda. El resultado compite por el contexto del turno. */
const MAX_RESULTS = 5;

/**
 * Búsqueda en el conocimiento de la organización, acotada al alcance del agente.
 *
 * Solo lectura. Delega íntegramente en el Retriever del Knowledge Engine: no consulta
 * `KnowledgeChunk` por su cuenta ni reimplementa ranking, igual que cualquier otra superficie
 * de consumo.
 *
 * El alcance de colecciones se propaga SIEMPRE. `RetrieveContext` solo filtra si la lista no
 * viene vacía, así que una herramienta que lo omitiera leería toda la organización — y lo
 * haría de forma indistinguible del funcionamiento correcto.
 */
@Injectable()
export class KnowledgeSearchTool implements ToolPort {
  readonly key: KnownTool = 'knowledge_search';
  readonly description =
    'Busca en el conocimiento interno indexado de la organización y devuelve fragmentos ' +
    'con su documento de origen.';

  constructor(private readonly retrieveContext: RetrieveContextUseCase) {}

  async execute(input: string, scope: ToolExecutionScope): Promise<ToolResult> {
    const chunks = await this.retrieveContext.execute({
      organizationId: scope.organizationId,
      query: input,
      knowledgeCollectionIds: scope.allowedCollectionIds,
      limit: MAX_RESULTS,
    });

    if (chunks.length === 0) {
      return {
        content:
          'No hay conocimiento indexado que responda a esa búsqueda dentro del alcance ' +
          'de este agente.',
      };
    }

    return {
      content: chunks
        .map(
          (chunk, index) =>
            `[${index + 1}] ${citationLabel(chunk.citation)}\n${chunk.content}`,
        )
        .join('\n\n'),
      citations: chunks.map((chunk) => ({
        knowledgeItemId: chunk.citation.knowledgeItemId,
        chunkId: chunk.chunkId,
        label: citationLabel(chunk.citation),
      })),
    };
  }
}

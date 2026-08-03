import { Injectable } from '@nestjs/common';
import { RetrieveInsightsUseCase } from '../../../understanding-engine/application/retrieve-insights.use-case';
import type { KnownTool } from '../../domain/agent-configuration';
import type {
  ToolExecutionScope,
  ToolPort,
  ToolResult,
} from '../../domain/ports/tool.port';

const MAX_RESULTS = 5;

/**
 * Consulta lo que la organización ya ha COMPRENDIDO sobre un asunto.
 *
 * Solo lectura, y siempre a través de `RetrieveInsights`: es el único punto de lectura de
 * comprensión del sistema, y el único que aplica la regla de cobertura completa del
 * `EffectiveCollectionScope`. Una herramienta que consultara `Insight` directamente se
 * saltaría esa regla y entregaría conclusiones sostenidas por evidencia fuera del alcance
 * del agente.
 */
@Injectable()
export class InsightLookupTool implements ToolPort {
  readonly key: KnownTool = 'insight_lookup';
  readonly description =
    'Consulta las conclusiones que la organización ya ha derivado de su conocimiento, ' +
    'con su confianza y su frescura.';

  constructor(private readonly retrieveInsights: RetrieveInsightsUseCase) {}

  async execute(
    _input: string,
    scope: ToolExecutionScope,
  ): Promise<ToolResult> {
    const insights = await this.retrieveInsights.execute({
      organizationId: scope.organizationId,
      allowedCollectionIds: scope.allowedCollectionIds,
      limit: MAX_RESULTS,
    });

    if (insights.length === 0) {
      return {
        content:
          'La organización no ha derivado todavía ninguna conclusión dentro del alcance ' +
          'de este agente.',
      };
    }

    return {
      content: insights
        .map((insight) => {
          const stale =
            insight.freshness !== 'FRESH'
              ? `, ${insight.freshness.toLowerCase()}: pendiente de revisión`
              : '';
          return `- ${insight.summary} (confianza ${insight.confidence.toFixed(2)}${stale})`;
        })
        .join('\n'),
    };
  }
}

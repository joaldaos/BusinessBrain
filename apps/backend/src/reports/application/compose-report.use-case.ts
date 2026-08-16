import { Injectable, Logger } from '@nestjs/common';
import { RetrieveInsightsUseCase } from '../../understanding-engine/application/retrieve-insights.use-case';
import { RetrieveContextUseCase } from '../../knowledge-engine/application/retrieve-context.use-case';
import { CollectionAccessService } from '../../knowledge-engine/application/collection-access.service';
import { collectionsScope } from '../../knowledge-engine/domain/knowledge-scope';
import {
  parseReportTemplate,
  type ReportSection,
} from '../domain/report-template';

/**
 * Compone el contenido de un informe — fase 6.
 *
 * ## Un informe se genera SIEMPRE en nombre de una persona
 *
 * No hay generación "del sistema". Bajo demanda es quien la pide; programada, quien creó la
 * automatización —ya verificada como miembro vigente por `RunAutomationUseCase`—. De ahí sale
 * el alcance, y de ahí sale la única garantía que importa: **un informe nunca contiene
 * comprensión ni conocimiento que su destinatario no pudiera leer por HTTP**.
 *
 * Un PDF es la forma más fácil de que una fuga sobreviva a los permisos: se descarga, se
 * reenvía y ya nadie vuelve a comprobar nada. Por eso el alcance no se relaja aquí ni por
 * comodidad ni por tratarse de una ejecución automática.
 *
 * ## No lee por su cuenta
 *
 * Cada sección se resuelve exclusivamente por `RetrieveInsights` (§12) o `RetrieveContext`
 * (§13). Ninguna consulta propia sobre `Insight` ni `KnowledgeChunk`: hacerlo abriría un
 * tercer camino a los datos con reglas distintas —sin decaimiento, sin frescura, sin curación
 * heredada, sin exclusión de estados terminales— que es exactamente lo que 6.4 quitó del
 * sistema.
 */

export interface ComposedSection {
  type: ReportSection['type'];
  title: string;
  /** Filas ya listas para pintar. */
  rows: { primary: string; secondary: string }[];
  /** Qué se leyó para producirla. Es lo que hace el informe trazable. */
  evidence: { kind: string; refId: string }[];
  /** Nada visible dentro del alcance del lector. Se dice, no se disimula. */
  empty: boolean;
}

export interface ComposedReport {
  sections: ComposedSection[];
  /** Colecciones con las que se leyó. Queda en el `ReportRun`. */
  scopeCollectionIds: string[];
  generatedAt: Date;
}

@Injectable()
export class ComposeReportUseCase {
  private readonly logger = new Logger(ComposeReportUseCase.name);

  constructor(
    private readonly retrieveInsights: RetrieveInsightsUseCase,
    private readonly retrieveContext: RetrieveContextUseCase,
    private readonly collectionAccess: CollectionAccessService,
  ) {}

  async execute(params: {
    organizationId: string;
    /** En nombre de quién se genera. Nunca opcional. */
    actorUserId: string;
    template: unknown;
  }): Promise<ComposedReport> {
    const { sections } = parseReportTemplate(params.template);

    // Alcance de ESTA persona, resuelto ahora. Sin concesiones, `collectionsScope` produce un
    // alcance vacío y ambos puntos de lectura devuelven nada — fail-closed, nunca "todo".
    const allowedCollectionIds =
      await this.collectionAccess.accessibleCollectionIds({
        organizationId: params.organizationId,
        userId: params.actorUserId,
      });
    const scope = collectionsScope(allowedCollectionIds);

    const composed: ComposedSection[] = [];
    for (const section of sections) {
      composed.push(
        section.type === 'INSIGHTS'
          ? await this.composeInsights(params.organizationId, scope, section)
          : await this.composeKnowledge(params.organizationId, scope, section),
      );
    }

    return {
      sections: composed,
      scopeCollectionIds: allowedCollectionIds,
      generatedAt: new Date(),
    };
  }

  private async composeInsights(
    organizationId: string,
    scope: ReturnType<typeof collectionsScope>,
    section: Extract<ReportSection, { type: 'INSIGHTS' }>,
  ): Promise<ComposedSection> {
    const insights = await this.retrieveInsights.execute({
      organizationId,
      scope,
      types: section.insightTypes,
      minimumConfidence: section.minimumConfidence,
      limit: section.limit,
    });

    return {
      type: section.type,
      title: section.title,
      rows: insights.map((insight) => ({
        primary: insight.summary,
        // La confianza y la frescura viajan con la conclusión, igual que por HTTP: un
        // Insight no fresco jamás se presenta como vigente (§3.4). Y si hay curación, se
        // dice de quién es la decisión y sobre qué versión se tomó (7.1).
        secondary: this.describeInsight(insight),
      })),
      evidence: insights.map((insight) => ({
        kind: 'INSIGHT',
        refId: insight.id,
      })),
      empty: insights.length === 0,
    };
  }

  private describeInsight(insight: {
    type: string;
    confidence: number;
    freshness: string;
    curation: { type: string; origin: string; disputed: boolean } | null;
  }): string {
    const parts = [
      insight.type,
      `confianza ${insight.confidence.toFixed(2)}`,
      `evidencia ${insight.freshness.toLowerCase()}`,
    ];

    if (insight.curation) {
      const origen =
        insight.curation.origin === 'OWN'
          ? 'validado por una persona'
          : 'validado sobre una versión anterior';
      parts.push(insight.curation.disputed ? `${origen} — EN DISPUTA` : origen);
    }

    return parts.join(' · ');
  }

  private async composeKnowledge(
    organizationId: string,
    scope: ReturnType<typeof collectionsScope>,
    section: Extract<ReportSection, { type: 'KNOWLEDGE_SEARCH' }>,
  ): Promise<ComposedSection> {
    const chunks = await this.retrieveContext.execute({
      organizationId,
      query: section.query,
      scope,
      minimumConfidence: section.minimumConfidence,
      limit: section.limit,
    });

    return {
      type: section.type,
      title: section.title,
      rows: chunks.map((chunk) => ({
        primary: chunk.content.slice(0, 500),
        secondary:
          `${chunk.citation.title}` +
          `${chunk.citation.heading ? ` › ${chunk.citation.heading}` : ''}` +
          ` · confianza ${chunk.confidenceScore.toFixed(2)}`,
      })),
      evidence: chunks.map((chunk) => ({
        kind: 'KNOWLEDGE_CHUNK',
        refId: chunk.chunkId,
      })),
      empty: chunks.length === 0,
    };
  }
}

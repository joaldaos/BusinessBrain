import { Injectable, Logger } from '@nestjs/common';
import { RetrieveInsightsUseCase } from '../../understanding-engine/application/retrieve-insights.use-case';
import { RetrieveContextUseCase } from '../../knowledge-engine/application/retrieve-context.use-case';
import { CollectionAccessService } from '../../knowledge-engine/application/collection-access.service';
import { narrarConclusion } from '../../understanding-engine/domain/insight-narrative';
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
  /**
   * Filas ya listas para pintar, en dos niveles.
   *
   * Arriba lo que entiende quien recibe el informe —el hallazgo, qué se detectó, por qué
   * importa y qué hacer—; en el anexo lo que hace falta para comprobarlo. Antes había un
   * solo nivel y era el técnico: cada punto del informe abría con la frase del motor y
   * seguía con `ANOMALY · confianza 0.90 · evidencia fresh`.
   */
  rows: {
    primary: string;
    detected?: string | null;
    matters?: string | null;
    whatToDo?: string | null;
    /** De qué documento sale, cuando la fila lo tiene. */
    source?: string | null;
    /** Ficha técnica, para el anexo. */
    technical: string;
    /** El texto original del motor, para el anexo. Nulo cuando la fila no lo tiene. */
    verbatim?: string | null;
  }[];
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
      rows: insights.map((insight) => {
        const narrativa = narrarConclusion(insight);
        return {
          primary: narrativa.titular,
          detected: narrativa.detectado,
          matters: narrativa.porQueImporta,
          whatToDo: narrativa.queHacer,
          // La confianza y la frescura viajan con la conclusión, igual que por HTTP: un
          // Insight no fresco jamás se presenta como vigente (§3.4). Y si hay curación, se
          // dice de quién es la decisión y sobre qué versión se tomó (7.1). Va al anexo:
          // sigue entero, pero deja de ser lo que se lee debajo de cada hallazgo.
          technical: this.describeInsight(insight),
          /*
           * El resumen literal del motor, para el anexo.
           *
           * Es lo que hace el informe comprobable: quien quiera verificar por qué el sistema
           * afirma algo tiene la frase original con sus números. Se guarda aquí y no se
           * pierde nunca, aunque el nivel principal lo cuente con otras palabras.
           */
          verbatim: insight.summary,
        };
      }),
      evidence: insights.map((insight) => ({
        kind: 'INSIGHT',
        refId: insight.id,
      })),
      empty: insights.length === 0,
    };
  }

  /**
   * La ficha técnica de una conclusión: tipo, confianza, frescura y curación.
   *
   * Sigue diciendo exactamente lo mismo que antes. Lo único que cambia es dónde se lee: en el
   * anexo, no debajo de cada hallazgo. Un informe que se lleva a una reunión no puede abrir
   * cada punto con `ANOMALY · confianza 0.90 · evidencia fresh`.
   */
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
        detected: null,
        matters: null,
        whatToDo: null,
        source:
          `${chunk.citation.title}` +
          `${chunk.citation.heading ? ` › ${chunk.citation.heading}` : ''}`,
        technical: `confianza ${chunk.confidenceScore.toFixed(2)}`,
        verbatim: null,
      })),
      evidence: chunks.map((chunk) => ({
        kind: 'KNOWLEDGE_CHUNK',
        refId: chunk.chunkId,
      })),
      empty: chunks.length === 0,
    };
  }
}

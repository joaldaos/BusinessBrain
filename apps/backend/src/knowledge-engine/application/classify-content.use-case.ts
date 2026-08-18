import { Injectable, Logger } from '@nestjs/common';
import type { AgentArea } from '@businessbrain/database';
import { ProviderRegistry } from '../../llm/application/provider-registry.service';
import { TaxonomyService } from './taxonomy.service';

/**
 * Clasificación automática de contenido — KNOWLEDGE_ENGINE_DESIGN.md §9, §3.8.
 *
 * Asigna al `KnowledgeItem` el nodo MÁS ESPECÍFICO posible de la taxonomía de su
 * organización, un conjunto de etiquetas libres, y reporta su propia certeza — que es
 * insumo directo del confidence score (§8.1) y la señal que detecta contenido heterogéneo
 * para el refinamiento por chunk de la subfase 2.6 (§9, §3.6).
 *
 * El Knowledge Engine no decide qué proveedor de IA se usa (§1.4): resuelve el perfil de
 * la organización a través de `ProviderRegistry`, igual que cualquier otro consumidor.
 */

export interface ClassificationResult {
  taxonomyNodeId: string | null;
  taxonomyKey: string | null;
  businessArea: AgentArea | null;
  tags: string[];
  /** Certeza en [0,1] reportada por el clasificador. */
  certainty: number;
}

/** Longitud de contenido que se envía al clasificador. */
const CLASSIFICATION_EXCERPT_LENGTH = 4000;
const MAX_TAGS = 8;

@Injectable()
export class ClassifyContentUseCase {
  private readonly logger = new Logger(ClassifyContentUseCase.name);

  constructor(
    private readonly providerRegistry: ProviderRegistry,
    private readonly taxonomy: TaxonomyService,
  ) {}

  async execute(params: {
    organizationId: string;
    title: string;
    contentText: string;
  }): Promise<ClassificationResult> {
    const { organizationId, title, contentText } = params;

    await this.taxonomy.ensureSeeded(organizationId);
    const nodes = await this.taxonomy.listNodes(organizationId);

    const vocabulary = nodes.map((n) => `${n.key} — ${n.label}`).join('\n');
    const excerpt = contentText.slice(0, CLASSIFICATION_EXCERPT_LENGTH);

    const systemPrompt = [
      'Clasificas documentos de una empresa contra una taxonomía cerrada.',
      'Responde ÚNICAMENTE con un objeto JSON, sin texto adicional ni bloques de código.',
      'Formato: {"key": string, "tags": string[], "certainty": number}',
      '- "key" DEBE ser exactamente una de las claves de la taxonomía. Elige la más específica que encaje.',
      '- "tags": hasta 8 etiquetas libres en minúsculas, sin espacios (usa guiones), para matices que la taxonomía no cubre.',
      '- "certainty": número entre 0 y 1. Usa un valor bajo si el documento mezcla varias áreas de negocio o no encaja bien.',
      '',
      'Taxonomía disponible:',
      vocabulary,
    ].join('\n');

    try {
      const { profile, provider, apiKey } =
        await this.providerRegistry.resolveForOrganization(organizationId);

      const result = await provider.complete(
        {
          systemPrompt,
          messages: [
            {
              role: 'user',
              content: `Título: ${title}\n\nContenido:\n${excerpt}`,
            },
          ],
          temperature: 0,
          maxTokens: 500,
        },
        profile.modelName,
        apiKey,
      );

      return this.parseAndResolve(organizationId, result.content, nodes);
    } catch (error) {
      // La clasificación NO es crítica para la ingesta: un fallo del proveedor no debe
      // impedir que el conocimiento se indexe. El ítem queda sin clasificar y con certeza
      // nula, lo que el cálculo de confianza trata explícitamente como valor neutro (§8.1)
      // en vez de penalizarlo como si fuera contenido poco fiable.
      this.logger.warn(
        `Clasificación automática fallida para "${title}": ${(error as Error).message}. El ítem se indexa sin clasificar.`,
      );
      return {
        taxonomyNodeId: null,
        taxonomyKey: null,
        businessArea: null,
        tags: [],
        certainty: 0,
      };
    }
  }

  private parseAndResolve(
    organizationId: string,
    raw: string,
    nodes: Awaited<ReturnType<TaxonomyService['listNodes']>>,
  ): ClassificationResult {
    const parsed = this.extractJson(raw);

    const key = typeof parsed?.key === 'string' ? parsed.key : null;
    // El nodo debe existir en la taxonomía de ESTA organización: un modelo puede
    // alucinar una clave plausible pero inexistente, y no se acepta por su aspecto.
    const node = key ? (nodes.find((n) => n.key === key) ?? null) : null;

    const tags = Array.isArray(parsed?.tags)
      ? parsed.tags
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0)
          .slice(0, MAX_TAGS)
      : [];

    const rawCertainty =
      typeof parsed?.certainty === 'number' ? parsed.certainty : 0;
    // Si la clave no resolvió contra la taxonomía real, la certeza no puede sostenerse
    // aunque el modelo la reportara alta.
    const certainty = node ? Math.min(1, Math.max(0, rawCertainty)) : 0;

    if (key && !node) {
      this.logger.warn(
        `El clasificador devolvió la clave "${key}", inexistente en la taxonomía de la organización ${organizationId}. Se descarta.`,
      );
    }

    return {
      taxonomyNodeId: node?.id ?? null,
      taxonomyKey: node?.key ?? null,
      businessArea: node?.businessArea ?? null,
      tags,
      certainty,
    };
  }

  /** Tolera que el modelo envuelva el JSON en prosa o en un bloque de código. */
  private extractJson(raw: string): Record<string, unknown> | null {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

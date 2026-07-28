import { Inject, Injectable, Logger } from '@nestjs/common';
import { InsightType } from '@businessbrain/database';
import { ProviderRegistry } from '../../../llm/application/provider-registry.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  KNOWLEDGE_RETRIEVAL_PORT,
  type KnowledgeRetrievalPort,
  type RetrievedKnowledge,
} from '../../domain/ports/knowledge-retrieval.port';
import type {
  InsightCandidate,
  ProposedEvidence,
  ReasoningContext,
  ReasoningStrategyPort,
} from '../../domain/ports/reasoning-strategy.port';

/**
 * Estrategia GENERATIVA — UNDERSTANDING_ENGINE_DESIGN.md §6, subfase 3.3.
 *
 * Recibe el resultado del Retriever y pide a un LLM sintetizar, correlacionar o explicar.
 * La más flexible y la más cara, y la que exige la traza más estricta (§10) porque su
 * proceso no es auditable paso a paso como el de una estrategia determinista.
 *
 * Fiabilidad base MENOR que la simbólica: su salida es una interpretación, no la aplicación
 * de una regla verificable. Esa diferencia viaja al `Insight` a través de la composición de
 * confianza (§9), de modo que una conclusión generada nunca pesa lo mismo que un hecho.
 *
 * Nunca produce `RISK`/`OPPORTUNITY` por su cuenta sin declarar su degradación: el gate de
 * §8 exige esa declaración, y una estrategia generativa es precisamente la que más
 * probabilidades tiene de proponer un juicio de valor que no puede justificar.
 */

/** Consultas temáticas con las que se sondea el conocimiento de la organización. */
const SYNTHESIS_PROBES = [
  'problemas recurrentes, incidencias o quejas mencionadas',
  'riesgos, incumplimientos o plazos comprometidos',
  'cambios de proceso, política o forma de trabajar',
] as const;

const CHUNKS_PER_PROBE = 8;
/** Mínimo de fragmentos para que una síntesis tenga sentido: no se razona sobre nada. */
const MIN_CHUNKS_TO_SYNTHESIZE = 3;
const MAX_CANDIDATES_PER_RUN = 5;

interface GenerativeFinding {
  subject: string;
  type: string;
  summary: string;
  reasoning: string;
  chunkIds: string[];
  confidence: number;
  degradesTo?: string;
}

@Injectable()
export class GenerativeSynthesisStrategy implements ReasoningStrategyPort {
  private readonly logger = new Logger(GenerativeSynthesisStrategy.name);

  readonly key = 'generative-synthesis';
  readonly version = '1.0.0';
  readonly kind = 'GENERATIVE' as const;

  /**
   * Menor que la simbólica (0.9): un modelo interpreta, no verifica. La confianza compuesta
   * (§9) traslada esa diferencia al `Insight` resultante.
   */
  readonly baseReliability = 0.6;

  readonly producibleTypes = [
    InsightType.PATTERN,
    InsightType.ANOMALY,
    InsightType.RISK,
    InsightType.OPPORTUNITY,
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRegistry: ProviderRegistry,
    @Inject(KNOWLEDGE_RETRIEVAL_PORT)
    private readonly knowledgeRetrieval: KnowledgeRetrievalPort,
  ) {}

  async generate(context: ReasoningContext): Promise<InsightCandidate[]> {
    const chunks = await this.gatherContext(context.organizationId);

    if (chunks.length < MIN_CHUNKS_TO_SYNTHESIZE) {
      // Sin material suficiente no se razona: es preferible no producir nada a producir una
      // conclusión sobre un conocimiento que no da para sostenerla.
      return [];
    }

    try {
      const findings = await this.synthesize(context.organizationId, chunks);
      return findings
        .slice(0, MAX_CANDIDATES_PER_RUN)
        .map((finding) => this.toCandidate(finding, chunks))
        .filter((c): c is InsightCandidate => c !== null);
    } catch (error) {
      // Un fallo del proveedor no puede tumbar el AnalysisRun completo: las estrategias
      // deterministas y simbólicas que ya corrieron conservan su resultado.
      this.logger.warn(
        `Síntesis generativa fallida para la organización ${context.organizationId}: ` +
          `${(error as Error).message}. La ejecución continúa sin sus candidatos.`,
      );
      return [];
    }
  }

  /** Sondea el conocimiento indexado a través del Retriever, nunca del Context Builder (§13). */
  private async gatherContext(
    organizationId: string,
  ): Promise<RetrievedKnowledge[]> {
    const byChunkId = new Map<string, RetrievedKnowledge>();

    for (const probe of SYNTHESIS_PROBES) {
      const results = await this.knowledgeRetrieval.retrieve({
        organizationId,
        query: probe,
        limit: CHUNKS_PER_PROBE,
      });
      for (const result of results) {
        byChunkId.set(result.chunkId, result);
      }
    }

    return [...byChunkId.values()];
  }

  private async synthesize(
    organizationId: string,
    chunks: RetrievedKnowledge[],
  ): Promise<GenerativeFinding[]> {
    const { profile, provider } =
      await this.providerRegistry.resolveForOrganization(organizationId);

    const corpus = chunks
      .map(
        (chunk, index) =>
          `[${index}] id=${chunk.chunkId} | "${chunk.title}"` +
          `${chunk.heading ? ` › ${chunk.heading}` : ''} (confianza ${chunk.confidenceScore.toFixed(2)})\n` +
          chunk.content,
      )
      .join('\n\n---\n\n');

    const systemPrompt = [
      'Analizas conocimiento interno de una empresa y detectas hallazgos transversales:',
      'patrones recurrentes, anomalías, riesgos u oportunidades.',
      '',
      'Responde ÚNICAMENTE con un array JSON, sin texto adicional ni bloques de código.',
      'Cada elemento: {"subject": string, "type": string, "summary": string,',
      '  "reasoning": string, "chunkIds": string[], "confidence": number, "degradesTo": string}',
      '',
      '- "subject": identificador estable y corto del ASUNTO, en kebab-case. Debe describir el',
      '  tema, NUNCA el momento ni el documento concreto. Ejemplo: "retrasos-entrega-proveedor".',
      '- "type": PATTERN | ANOMALY | RISK | OPPORTUNITY.',
      '- "reasoning": explica el razonamiento paso a paso. Es OBLIGATORIO y se audita.',
      '- "chunkIds": los id exactos de los fragmentos que sostienen el hallazgo. Solo de la lista.',
      '- "confidence": 0 a 1, según lo sólido que sea el hallazgo en el material disponible.',
      '- "degradesTo": OBLIGATORIO si type es RISK u OPPORTUNITY. PATTERN o ANOMALY: a qué',
      '  se reduce el hallazgo si no puede anclarse a un objetivo de negocio declarado.',
      '',
      'No inventes hallazgos: si el material no sostiene ninguno, devuelve [].',
    ].join('\n');

    const result = await provider.complete(
      {
        systemPrompt,
        messages: [{ role: 'user', content: corpus }],
        temperature: 0,
        maxTokens: 2000,
      },
      profile.modelName,
      profile.apiKeyEnc ?? undefined,
    );

    return this.parseFindings(result.content);
  }

  private parseFindings(raw: string): GenerativeFinding[] {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];

    try {
      const parsed: unknown = JSON.parse(match[0]);
      return Array.isArray(parsed) ? (parsed as GenerativeFinding[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Convierte un hallazgo del modelo en candidato, validando todo lo que el modelo pudo
   * alucinar: el tipo, los fragmentos citados y la declaración de degradación.
   */
  private toCandidate(
    finding: GenerativeFinding,
    chunks: RetrievedKnowledge[],
  ): InsightCandidate | null {
    const type = this.parseType(finding.type);
    if (
      !type ||
      typeof finding.subject !== 'string' ||
      finding.subject.length === 0
    ) {
      return null;
    }

    // La traza de razonamiento es OBLIGATORIA para una estrategia generativa (§10): sin
    // ella el Insight no sería auditable, y se descarta antes de persistirse.
    if (
      typeof finding.reasoning !== 'string' ||
      finding.reasoning.trim().length === 0
    ) {
      this.logger.warn(
        `Hallazgo "${finding.subject}" descartado: sin traza de razonamiento (§10)`,
      );
      return null;
    }

    // Solo se acepta evidencia que exista de verdad: un modelo puede citar un id
    // plausible pero inexistente, y aceptarlo rompería la trazabilidad.
    const validChunkIds = new Set(chunks.map((c) => c.chunkId));
    const evidence: ProposedEvidence[] = (finding.chunkIds ?? [])
      .filter((id) => validChunkIds.has(id))
      .map((id) => ({
        kind: 'KNOWLEDGE_CHUNK' as const,
        role: 'BASELINE' as const,
        refId: id,
      }));

    if (evidence.length === 0) {
      this.logger.warn(
        `Hallazgo "${finding.subject}" descartado: no cita ningún fragmento real`,
      );
      return null;
    }

    const degradesTo = this.parseDegradation(finding.degradesTo);
    const requiresDegradation =
      type === InsightType.RISK || type === InsightType.OPPORTUNITY;

    if (requiresDegradation && !degradesTo) {
      // El contrato del puerto lo exige (§13) y el gate no puede decidirlo por la
      // estrategia. Se degrada aquí al tipo más conservador en vez de descartar el
      // hallazgo: la observación es válida, lo que no puede sostenerse es el juicio.
      this.logger.warn(
        `Hallazgo "${finding.subject}" propuesto como ${type} sin declarar degradación: ` +
          `se reclasifica como ANOMALY`,
      );
      return this.buildCandidate(
        finding,
        InsightType.ANOMALY,
        evidence,
        undefined,
      );
    }

    return this.buildCandidate(finding, type, evidence, degradesTo);
  }

  private buildCandidate(
    finding: GenerativeFinding,
    type: InsightType,
    evidence: ProposedEvidence[],
    degradesTo: Extract<InsightType, 'PATTERN' | 'ANOMALY'> | undefined,
  ): InsightCandidate {
    const rawConfidence =
      typeof finding.confidence === 'number'
        ? Math.min(1, Math.max(0, finding.confidence))
        : 0.5;

    return {
      subjectIdentity: `generative-synthesis:${finding.subject}`,
      type,
      summary: String(finding.summary ?? finding.subject),
      evidence,
      rawConfidence,
      degradesTo,
      reasoningTrace: {
        strategyKind: 'GENERATIVE',
        // Razonamiento del modelo como parte OBLIGATORIA de la salida (§10).
        modelReasoning: finding.reasoning,
        // Referencias verificables al contexto utilizado: qué entregó el Retriever.
        citedChunkIds: evidence.map((e) => e.refId),
        proposedType: finding.type,
        modelConfidence: rawConfidence,
      },
    };
  }

  private parseType(raw: unknown): InsightType | null {
    if (typeof raw !== 'string') return null;
    const normalized = raw.toUpperCase();
    return (Object.values(InsightType) as string[]).includes(normalized)
      ? (normalized as InsightType)
      : null;
  }

  private parseDegradation(
    raw: unknown,
  ): Extract<InsightType, 'PATTERN' | 'ANOMALY'> | undefined {
    if (typeof raw !== 'string') return undefined;
    const normalized = raw.toUpperCase();
    return normalized === 'PATTERN' || normalized === 'ANOMALY'
      ? normalized
      : undefined;
  }
}

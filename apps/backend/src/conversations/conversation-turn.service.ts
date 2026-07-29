import { Injectable } from '@nestjs/common';
import { MessageRole, Prisma } from '@businessbrain/database';
import { PrismaService } from '../prisma/prisma.service';
import { RetrieveContextUseCase } from '../knowledge-engine/application/retrieve-context.use-case';
import { RetrieveInsightsUseCase } from '../understanding-engine/application/retrieve-insights.use-case';
import {
  DEFAULT_KNOWLEDGE_TOKEN_BUDGET,
  buildContext,
  citationLabel,
} from '../knowledge-engine/domain/context-builder';
import type { LlmCompletionRequest } from '../llm/domain/ports/llm-provider.port';
import { ConversationsService } from './conversations.service';
import {
  PromptBuilderService,
  type PromptInsight,
} from './prompt-builder.service';

/**
 * Un turno de conversación — BUSINESSBRAIN_MIGRATION_PLAN.md §7.2, Fase 4.
 *
 * El chat es una **interfaz de la comprensión, no el núcleo del sistema**. Por eso el orden
 * de este turno importa y no es intercambiable:
 *
 * 1. Pregunta al Understanding Engine qué COMPRENDE la organización sobre el asunto
 *    (`RetrieveInsights`) — conclusiones ya razonadas, con su confianza y su frescura.
 * 2. Pide al Knowledge Engine el conocimiento que RESPALDA la respuesta (Retriever).
 * 3. Ensambla el contexto con el Context Builder (§14) y construye el prompt.
 *
 * Vive aparte de los dos casos de uso que lo consumen —respuesta síncrona y streaming—
 * porque ambos deben preparar el turno de forma IDÉNTICA. Si divergieran, la misma pregunta
 * daría respuestas distintas según cómo la pidiera el cliente.
 *
 * No contiene lógica de RAG ni de razonamiento propia: no reordena, no filtra por confianza,
 * no decide qué es relevante. Todo eso ya ocurrió aguas arriba.
 */

const KNOWLEDGE_CHUNKS = 8;
const MAX_INSIGHTS = 5;

export interface MessageCitation {
  ordinal: number;
  knowledgeItemId: string;
  chunkId: string;
  label: string;
}

export interface PreparedTurn {
  conversationId: string;
  userMessageId: string;
  citations: MessageCitation[];
  insights: (PromptInsight & { id: string })[];
  droppedChunkIds: string[];
  /** `null` si no hay conocimiento ni comprensión: entonces no se llama al modelo. */
  request: LlmCompletionRequest | null;
}

@Injectable()
export class ConversationTurnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly retrieveContext: RetrieveContextUseCase,
    private readonly retrieveInsights: RetrieveInsightsUseCase,
    private readonly promptBuilder: PromptBuilderService,
  ) {}

  /**
   * Persiste la pregunta y reúne todo lo necesario para responderla. La pregunta se guarda
   * ANTES de llamar al modelo: un fallo del proveedor no puede hacer que el usuario pierda
   * lo que escribió.
   */
  async prepare(params: {
    organizationId: string;
    userId: string;
    conversationId: string;
    content: string;
  }): Promise<PreparedTurn> {
    const conversation = await this.conversations.findOne({
      organizationId: params.organizationId,
      userId: params.userId,
      conversationId: params.conversationId,
    });

    const userMessage = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: MessageRole.USER,
        content: params.content,
      },
    });

    // 1. COMPRENSIÓN primero: qué sabe ya la organización sobre este asunto.
    const insights = await this.retrieveInsights.execute({
      organizationId: params.organizationId,
      limit: MAX_INSIGHTS,
    });

    // 2. CONOCIMIENTO después: qué respalda la respuesta.
    const retrieved = await this.retrieveContext.execute({
      organizationId: params.organizationId,
      query: params.content,
      limit: KNOWLEDGE_CHUNKS,
    });

    // 3. Ensamblado dentro del presupuesto, sin truncar fragmentos (§14).
    const context = buildContext(
      retrieved.map((chunk) => ({
        chunkId: chunk.chunkId,
        content: chunk.content,
        confidenceScore: chunk.confidenceScore,
        citation: chunk.citation,
      })),
      DEFAULT_KNOWLEDGE_TOKEN_BUDGET,
    );

    const promptInput = {
      question: params.content,
      context,
      insights: insights.map((insight) => ({
        summary: insight.summary,
        confidence: insight.confidence,
        freshness: insight.freshness,
      })),
      // El historial excluye la pregunta que se acaba de persistir: va aparte, como turno
      // actual, y duplicarla confundiría al modelo.
      history: conversation.messages,
    };

    return {
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      citations: context.pieces.map((piece) => ({
        ordinal: piece.ordinal,
        knowledgeItemId: piece.citation.knowledgeItemId,
        chunkId: piece.chunkId,
        label: citationLabel(piece.citation),
      })),
      insights: insights.map((insight) => ({
        id: insight.id,
        summary: insight.summary,
        confidence: insight.confidence,
        freshness: insight.freshness,
      })),
      droppedChunkIds: context.droppedChunkIds,
      request: this.promptBuilder.hasMaterial(promptInput)
        ? this.promptBuilder.build(promptInput)
        : null,
    };
  }

  noKnowledgeAnswer(): string {
    return this.promptBuilder.noKnowledgeAnswer();
  }

  /**
   * Cierra el turno persistiendo la respuesta con sus citas. Es lo que permite responder
   * "por qué la IA dijo esto" meses después: de qué documento y qué fragmento salió cada dato.
   */
  async persistAnswer(params: {
    conversationId: string;
    content: string;
    citations: MessageCitation[];
  }): Promise<string> {
    const message = await this.prisma.message.create({
      data: {
        conversationId: params.conversationId,
        role: MessageRole.ASSISTANT,
        content: params.content,
        citations: params.citations as unknown as Prisma.InputJsonValue,
      },
    });

    // Mantiene la conversación al frente de la lista sin tocar su contenido.
    await this.prisma.conversation.update({
      where: { id: params.conversationId },
      data: { updatedAt: new Date() },
    });

    return message.id;
  }

  providerFailureAnswer(): string {
    return (
      'No he podido generar la respuesta en este momento por un problema con el ' +
      'proveedor de IA. Tu mensaje se ha guardado; inténtalo de nuevo en unos instantes.'
    );
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { MessageRole, Prisma } from '@businessbrain/database';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../llm/application/provider-registry.service';
import { RetrieveContextUseCase } from '../knowledge-engine/application/retrieve-context.use-case';
import { RetrieveInsightsUseCase } from '../understanding-engine/application/retrieve-insights.use-case';
import {
  DEFAULT_KNOWLEDGE_TOKEN_BUDGET,
  GROUNDING_DIRECTIVE,
  buildContext,
  citationLabel,
  type BuiltContext,
} from '../knowledge-engine/domain/context-builder';
import { ConversationsService } from './conversations.service';

/**
 * Pipeline de respuesta del chat — BUSINESSBRAIN_MIGRATION_PLAN.md §7.2, Fase 4.
 *
 * El chat es una **interfaz de la comprensión, no el núcleo del sistema**. Por eso el orden
 * importa y no es intercambiable:
 *
 * 1. Pregunta al Understanding Engine qué COMPRENDE la organización sobre el asunto
 *    (`RetrieveInsights`) — conclusiones ya razonadas, con su confianza y su frescura.
 * 2. Pide al Knowledge Engine el conocimiento que RESPALDA la respuesta (Retriever).
 * 3. Ensambla el contexto con el Context Builder (§14) y construye el prompt.
 *
 * Esta superficie NO contiene lógica de RAG ni de razonamiento propia: no reordena, no
 * filtra por confianza, no decide qué es relevante. Todo eso ya ocurrió aguas arriba.
 */

/** Cuántos turnos previos se incluyen. El historial compite por el mismo presupuesto (§14). */
const HISTORY_TURNS = 10;
const KNOWLEDGE_CHUNKS = 8;
const MAX_INSIGHTS = 5;

export interface SendMessageParams {
  organizationId: string;
  userId: string;
  conversationId: string;
  content: string;
}

export interface MessageCitation {
  ordinal: number;
  knowledgeItemId: string;
  chunkId: string;
  label: string;
}

export interface SendMessageResult {
  userMessageId: string;
  assistantMessageId: string;
  content: string;
  citations: MessageCitation[];
  /** Comprensión que se usó, para que la superficie pueda mostrarla si quiere. */
  insightsUsed: {
    id: string;
    summary: string;
    confidence: number;
    freshness: string;
  }[];
  droppedChunkIds: string[];
}

@Injectable()
export class SendMessageUseCase {
  private readonly logger = new Logger(SendMessageUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly retrieveContext: RetrieveContextUseCase,
    private readonly retrieveInsights: RetrieveInsightsUseCase,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async execute(params: SendMessageParams): Promise<SendMessageResult> {
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

    const history = conversation.messages.slice(-HISTORY_TURNS);
    const answer = await this.generateAnswer({
      organizationId: params.organizationId,
      question: params.content,
      context,
      insights,
      history,
    });

    const citations: MessageCitation[] = context.pieces.map((piece) => ({
      ordinal: piece.ordinal,
      knowledgeItemId: piece.citation.knowledgeItemId,
      chunkId: piece.chunkId,
      label: citationLabel(piece.citation),
    }));

    const assistantMessage = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: MessageRole.ASSISTANT,
        content: answer,
        // Trazabilidad de "por qué la IA dijo esto" (§7.2): cada respuesta conserva de qué
        // documento y qué fragmento salió cada dato.
        citations: citations as unknown as Prisma.InputJsonValue,
      },
    });

    // Mantiene la conversación al frente de la lista sin tocar su contenido.
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    return {
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      content: answer,
      citations,
      insightsUsed: insights.map((i) => ({
        id: i.id,
        summary: i.summary,
        confidence: i.confidence,
        freshness: i.freshness,
      })),
      droppedChunkIds: context.droppedChunkIds,
    };
  }

  /**
   * Construye el prompt y genera la respuesta. El presupuesto de contexto es finito y
   * compartido: system prompt, comprensión, conocimiento e historial compiten por él (§14).
   */
  private async generateAnswer(params: {
    organizationId: string;
    question: string;
    context: BuiltContext;
    insights: { summary: string; confidence: number; freshness: string }[];
    history: { role: MessageRole; content: string }[];
  }): Promise<string> {
    // Sin conocimiento ni comprensión no se inventa una respuesta: se dice que no se sabe.
    if (params.context.pieces.length === 0 && params.insights.length === 0) {
      return (
        'No tengo conocimiento indexado que responda a esa pregunta. ' +
        'Si la información debería estar disponible, comprueba que la fuente correspondiente ' +
        'esté conectada y sincronizada.'
      );
    }

    const understanding =
      params.insights.length > 0
        ? [
            '',
            'Lo que la organización ya ha comprendido sobre su actividad:',
            ...params.insights.map(
              (i) =>
                `- ${i.summary} (confianza ${i.confidence.toFixed(2)}` +
                `${i.freshness !== 'FRESH' ? `, ${i.freshness.toLowerCase()}: pendiente de revisión` : ''})`,
            ),
          ].join('\n')
        : '';

    const systemPrompt = [
      'Eres el asistente de BusinessBrain. Respondes sobre el conocimiento interno de una empresa.',
      '',
      GROUNDING_DIRECTIVE,
      understanding,
      '',
      'Contexto recuperado:',
      params.context.text || '(sin fragmentos relevantes)',
    ].join('\n');

    try {
      const { profile, provider } =
        await this.providerRegistry.resolveForOrganization(
          params.organizationId,
        );

      const result = await provider.complete(
        {
          systemPrompt,
          messages: [
            ...params.history.map((message) => ({
              role:
                message.role === MessageRole.ASSISTANT
                  ? ('assistant' as const)
                  : ('user' as const),
              content: message.content,
            })),
            { role: 'user' as const, content: params.question },
          ],
          temperature: 0.2,
          maxTokens: 1500,
        },
        profile.modelName,
        profile.apiKeyEnc ?? undefined,
      );

      return result.content;
    } catch (error) {
      // Un fallo del proveedor no puede perder el mensaje del usuario, que ya está
      // persistido: se devuelve un aviso explícito en vez de romper la conversación.
      this.logger.warn(
        `Generación de respuesta fallida en la organización ${params.organizationId}: ` +
          `${(error as Error).message}`,
      );
      return (
        'No he podido generar la respuesta en este momento por un problema con el ' +
        'proveedor de IA. Tu mensaje se ha guardado; inténtalo de nuevo en unos instantes.'
      );
    }
  }
}

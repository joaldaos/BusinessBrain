import { Injectable, Logger } from '@nestjs/common';
import { ProviderRegistry } from '../llm/application/provider-registry.service';
import {
  ConversationTurnService,
  type MessageCitation,
  type PreparedTurn,
} from './conversation-turn.service';

/**
 * Respuesta síncrona del chat — BUSINESSBRAIN_MIGRATION_PLAN.md §7.2, Fase 4.
 *
 * Devuelve la respuesta completa de una vez. El camino equivalente en streaming es
 * `StreamMessageUseCase`; ambos preparan el turno con `ConversationTurnService`, de modo
 * que la misma pregunta produce el mismo prompt independientemente de cómo se pida.
 */

export interface SendMessageParams {
  organizationId: string;
  userId: string;
  conversationId: string;
  content: string;
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
    private readonly turn: ConversationTurnService,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async execute(params: SendMessageParams): Promise<SendMessageResult> {
    const prepared = await this.turn.prepare(params);
    const answer = await this.generateAnswer(prepared, params.organizationId);

    const assistantMessageId = await this.turn.persistAnswer({
      conversationId: prepared.conversationId,
      content: answer,
      citations: prepared.citations,
    });

    return {
      userMessageId: prepared.userMessageId,
      assistantMessageId,
      content: answer,
      citations: prepared.citations,
      insightsUsed: prepared.insights,
      droppedChunkIds: prepared.droppedChunkIds,
    };
  }

  private async generateAnswer(
    prepared: PreparedTurn,
    organizationId: string,
  ): Promise<string> {
    // Sin conocimiento ni comprensión no se inventa una respuesta: se dice que no se sabe.
    if (!prepared.request) return this.turn.noKnowledgeAnswer();

    try {
      const { profile, provider } =
        await this.providerRegistry.resolveForOrganization(organizationId);

      const result = await provider.complete(
        prepared.request,
        profile.modelName,
        profile.apiKeyEnc ?? undefined,
      );

      return result.content;
    } catch (error) {
      // Un fallo del proveedor no puede perder el mensaje del usuario, que ya está
      // persistido: se devuelve un aviso explícito en vez de romper la conversación.
      this.logger.warn(
        `Generación de respuesta fallida en la organización ${organizationId}: ` +
          `${(error as Error).message}`,
      );
      return this.turn.providerFailureAnswer();
    }
  }
}

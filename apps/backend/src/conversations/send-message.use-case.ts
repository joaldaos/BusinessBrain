import { Injectable, Logger } from '@nestjs/common';
import { ProviderRegistry } from '../llm/application/provider-registry.service';
import { parseAgentDirectives } from '../agents/domain/agent-directives';
import type { ToolInvocationTrace } from '../agents/application/agent-tool-loop.use-case';
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
  /** Cuántas anotaciones de memoria dejó el agente en este turno (5.9). */
  memoriesRecorded: number;
  /** Qué herramientas se pidieron, cuáles se ejecutaron y por qué se denegó el resto (5.9). */
  toolInvocations: ToolInvocationTrace[];
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
    const answered = await this.generateAnswer(prepared, params.organizationId);
    const { parsed, toolInvocations } = answered;

    // Anotar va después de responder: la respuesta ya está decidida y ningún fallo al
    // escribir memoria puede degradarla.
    const memoriesRecorded = await this.turn.recordAgentMemories({
      organizationId: params.organizationId,
      userId: params.userId,
      conversationId: prepared.conversationId,
      agentContext: prepared.agentContext,
      parsed,
    });

    // Se persiste el texto LIMPIO: el historial no debe arrastrar el protocolo, o el
    // siguiente turno lo recibiría como si fuera algo que dijo el asistente.
    const content = parsed.text;

    const assistantMessageId = await this.turn.persistAnswer({
      conversationId: prepared.conversationId,
      content,
      citations: prepared.citations,
    });

    return {
      userMessageId: prepared.userMessageId,
      assistantMessageId,
      content,
      citations: prepared.citations,
      insightsUsed: prepared.insights,
      droppedChunkIds: prepared.droppedChunkIds,
      memoriesRecorded,
      toolInvocations,
    };
  }

  private async generateAnswer(
    prepared: PreparedTurn,
    organizationId: string,
  ): Promise<{
    parsed: ReturnType<typeof parseAgentDirectives>;
    toolInvocations: ToolInvocationTrace[];
  }> {
    // Sin conocimiento ni comprensión no se inventa una respuesta: se dice que no se sabe.
    if (!prepared.request) {
      return {
        parsed: parseAgentDirectives(this.turn.noKnowledgeAnswer()),
        toolInvocations: [],
      };
    }

    try {
      // Perfil del agente si la conversación lo tiene (§7.3); si no, el de la organización.
      const { profile, provider, apiKey } =
        await this.providerRegistry.resolveForAgent(
          organizationId,
          prepared.llmProfileId,
        );

      // El MISMO bucle que usa el streaming. La vía síncrona envuelve `complete` en un
      // flujo de un solo trozo: así ambas superficies ejecutan exactamente las mismas
      // herramientas para la misma pregunta.
      const outcome = await this.turn.runAgentLoop({
        prepared,
        ask: (request) =>
          this.asSingleChunkStream(
            provider
              .complete(request, profile.modelName, apiKey)
              .then((result) => result.content),
          ),
      });

      return outcome;
    } catch (error) {
      // Un fallo del proveedor no puede perder el mensaje del usuario, que ya está
      // persistido: se devuelve un aviso explícito en vez de romper la conversación.
      this.logger.warn(
        `Generación de respuesta fallida en la organización ${organizationId}: ` +
          `${(error as Error).message}`,
      );
      return {
        parsed: parseAgentDirectives(this.turn.providerFailureAnswer()),
        toolInvocations: [],
      };
    }
  }

  /** Adapta una respuesta completa al mismo contrato de flujo que consume el bucle. */
  private async *asSingleChunkStream(
    answer: Promise<string>,
  ): AsyncIterable<string> {
    yield await answer;
  }
}

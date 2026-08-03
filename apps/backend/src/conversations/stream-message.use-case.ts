import { Injectable, Logger } from '@nestjs/common';
import { ProviderRegistry } from '../llm/application/provider-registry.service';
import {
  ConversationTurnService,
  type MessageCitation,
} from './conversation-turn.service';

/**
 * Respuesta en streaming — BUSINESSBRAIN_MIGRATION_PLAN.md §7.2, Fase 4.
 *
 * Mismo turno que `SendMessageUseCase` (mismo prompt, mismo orden comprensión → conocimiento),
 * entregado por fragmentos. Las decisiones propias del streaming:
 *
 * - **Las citas se emiten ANTES del primer fragmento de texto.** El usuario ve sobre qué se
 *   apoya la respuesta mientras se escribe, no después. Además, si la conexión se corta a
 *   mitad, lo que ya recibió sigue siendo trazable.
 * - **La respuesta se persiste al terminar, no fragmento a fragmento.** Un `Message` a
 *   medias no es una respuesta: sería historial corrupto que el siguiente turno arrastraría.
 * - **Un corte del cliente no descarta lo generado**: se persiste lo que hubiera llegado.
 */

export type MessageStreamEvent =
  | { type: 'context'; citations: MessageCitation[]; insights: StreamInsight[] }
  | { type: 'token'; text: string }
  | { type: 'done'; assistantMessageId: string; content: string }
  | { type: 'error'; message: string };

export interface StreamInsight {
  id: string;
  summary: string;
  confidence: number;
  freshness: string;
}

export interface StreamMessageParams {
  organizationId: string;
  userId: string;
  conversationId: string;
  content: string;
}

@Injectable()
export class StreamMessageUseCase {
  private readonly logger = new Logger(StreamMessageUseCase.name);

  constructor(
    private readonly turn: ConversationTurnService,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async *execute(
    params: StreamMessageParams,
  ): AsyncIterable<MessageStreamEvent> {
    const prepared = await this.turn.prepare(params);

    // Primero, sobre qué se apoya la respuesta. Después, la respuesta.
    yield {
      type: 'context',
      citations: prepared.citations,
      insights: prepared.insights,
    };

    // Sin conocimiento ni comprensión no se inventa nada: se dice y se cierra el turno.
    if (!prepared.request) {
      const content = this.turn.noKnowledgeAnswer();
      yield { type: 'token', text: content };
      yield {
        type: 'done',
        assistantMessageId: await this.turn.persistAnswer({
          conversationId: prepared.conversationId,
          content,
          citations: prepared.citations,
        }),
        content,
      };
      return;
    }

    let accumulated = '';
    let failed = false;

    try {
      // Mismo perfil que en la via sincrona: el del agente si lo declara (§7.3).
      const { profile, provider } = await this.providerRegistry.resolveForAgent(
        params.organizationId,
        prepared.llmProfileId,
      );

      for await (const delta of provider.stream(
        prepared.request,
        profile.modelName,
        profile.apiKeyEnc ?? undefined,
      )) {
        accumulated += delta;
        yield { type: 'token', text: delta };
      }
    } catch (error) {
      failed = true;
      this.logger.warn(
        `Streaming de respuesta fallido en la organización ${params.organizationId}: ` +
          `${(error as Error).message}`,
      );
    }

    // Un fallo tras haber emitido texto no lo descarta: lo que el usuario ya leyó se
    // persiste, y el aviso se añade para que el historial explique por qué se corta.
    const content = failed
      ? [accumulated, this.turn.providerFailureAnswer()]
          .filter(Boolean)
          .join('\n\n')
      : accumulated;

    const assistantMessageId = await this.turn.persistAnswer({
      conversationId: prepared.conversationId,
      content,
      citations: prepared.citations,
    });

    if (failed) {
      yield { type: 'error', message: this.turn.providerFailureAnswer() };
    }
    yield { type: 'done', assistantMessageId, content };
  }
}

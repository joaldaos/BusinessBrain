import { Module } from '@nestjs/common';
import { KnowledgeEngineModule } from '../knowledge-engine/knowledge-engine.module';
import { UnderstandingEngineModule } from '../understanding-engine/understanding-engine.module';
import { LlmModule } from '../llm/llm.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { SendMessageUseCase } from './send-message.use-case';
import { StreamMessageUseCase } from './stream-message.use-case';
import { ConversationTurnService } from './conversation-turn.service';
import { PromptBuilderService } from './prompt-builder.service';

/**
 * Superficie de consumo conversacional — Fase 4.
 *
 * NO es el núcleo. Consume el Understanding Engine (`RetrieveInsights`) y el Knowledge
 * Engine (Retriever) a través de sus contratos declarados, y no contiene lógica de RAG ni
 * de razonamiento propia: si necesita comprensión, la pide; nunca la reconstruye a partir
 * de fragmentos recuperados.
 */
@Module({
  imports: [KnowledgeEngineModule, UnderstandingEngineModule, LlmModule],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    PromptBuilderService,
    ConversationTurnService,
    SendMessageUseCase,
    StreamMessageUseCase,
  ],
  exports: [ConversationsService],
})
export class ConversationsModule {}

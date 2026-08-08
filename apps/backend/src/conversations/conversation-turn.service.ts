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
import { RunAgentUseCase } from '../agents/application/run-agent.use-case';
import { RecordAgentMemoryUseCase } from '../agents/application/record-agent-memory.use-case';
import {
  AgentToolLoopUseCase,
  type ToolInvocationTrace,
  type ToolLoopEvent,
} from '../agents/application/agent-tool-loop.use-case';
import type { AgentConfiguration } from '../agents/domain/agent-configuration';
import {
  parseAgentDirectives,
  DirectiveStreamFilter,
  type ParsedDirectives,
} from '../agents/domain/agent-directives';
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
 *
 * **Con `agentId`, el turno lo prepara `RunAgentUseCase`** (subfase 5.6), no una copia de su
 * lógica aquí. Eso importa por seguridad, no por limpieza: `RunAgentUseCase` es quien impone
 * el alcance fail-closed y quien resuelve la memoria privada del usuario. Duplicar su
 * preparación en el chat crearía un segundo camino al conocimiento con sus propias reglas —
 * exactamente la puerta trasera que `agentId` no puede ser.
 */

const KNOWLEDGE_CHUNKS = 8;
const MAX_INSIGHTS = 5;

/**
 * Contexto vacío para el camino del agente: su conocimiento ya viaja dentro del system
 * prompt que compuso `RunAgentUseCase`, y volver a insertarlo aquí lo duplicaría.
 */
const EMPTY_CONTEXT = buildContext([], DEFAULT_KNOWLEDGE_TOKEN_BUDGET);

export interface MessageCitation {
  ordinal: number;
  knowledgeItemId: string;
  chunkId: string;
  label: string;
}

/**
 * Lo que el turno necesita saber del agente DESPUÉS de que el modelo responda: para anotar
 * memoria con el alcance correcto y, en 5.9, para ejecutar herramientas con el mismo alcance
 * con el que se preparó el prompt.
 *
 * `null` en una conversación sin agente. Que sea nulo no es un detalle de tipos: es lo que
 * garantiza que el camino de Fase 4 no adquiere memoria ni herramientas por la puerta de atrás.
 */
export interface TurnAgentContext {
  /** Alcance del turno AUTENTICADO. Nunca proviene de lo que el modelo escriba. */
  organizationId: string;
  userId: string;
  agentId: string;
  configuration: AgentConfiguration;
  allowedCollectionIds: string[];
}

export interface PreparedTurn {
  conversationId: string;
  userMessageId: string;
  /** Perfil de LLM con el que responder: el del agente si lo declara (§7.3). */
  llmProfileId: string | null;
  citations: MessageCitation[];
  insights: (PromptInsight & { id: string })[];
  droppedChunkIds: string[];
  /** `null` si no hay conocimiento ni comprensión: entonces no se llama al modelo. */
  request: LlmCompletionRequest | null;
  /** `null` sin agente. Ver `TurnAgentContext`. */
  agentContext: TurnAgentContext | null;
}

@Injectable()
export class ConversationTurnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly retrieveContext: RetrieveContextUseCase,
    private readonly retrieveInsights: RetrieveInsightsUseCase,
    private readonly promptBuilder: PromptBuilderService,
    private readonly runAgent: RunAgentUseCase,
    private readonly recordMemory: RecordAgentMemoryUseCase,
    private readonly toolLoop: AgentToolLoopUseCase,
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

    // Con agente, TODA la preparación del turno la hace RunAgentUseCase: es quien impone el
    // alcance fail-closed y la memoria privada del usuario. Aquí no se replica nada de eso.
    if (conversation.agentId) {
      return this.prepareWithAgent({
        ...params,
        conversationId: conversation.id,
        agentId: conversation.agentId,
        userMessageId: userMessage.id,
        history: conversation.messages,
      });
    }

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
      llmProfileId: null,
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
      // Sin agente no hay memoria ni herramientas. Es la Fase 4 intacta.
      agentContext: null,
    };
  }

  /**
   * Recorre el turno del modelo, resolviendo las herramientas que pida.
   *
   * Es el ÚNICO punto por el que ambas superficies llaman al bucle, y por eso vive aquí y no
   * duplicado en cada caso de uso: si divergieran, la misma pregunta ejecutaría herramientas
   * distintas según se hubiera pedido por la vía síncrona o por streaming.
   *
   * **Sin agente no hay bucle.** Una conversación de Fase 4 hace una sola llamada y sus
   * directivas se separan igualmente, para que el protocolo nunca llegue a la persona.
   */
  async *streamAgentLoop(params: {
    prepared: PreparedTurn;
    ask: (request: LlmCompletionRequest) => AsyncIterable<string>;
  }): AsyncGenerator<
    ToolLoopEvent,
    { parsed: ParsedDirectives; toolInvocations: ToolInvocationTrace[] }
  > {
    const { prepared } = params;
    if (!prepared.request) {
      return { parsed: parseAgentDirectives(''), toolInvocations: [] };
    }

    if (!prepared.agentContext) {
      // Camino de Fase 4, intacto: una sola pasada y ninguna herramienta.
      const filter = new DirectiveStreamFilter();
      for await (const delta of params.ask(prepared.request)) {
        const visible = filter.push(delta);
        if (visible.length > 0) yield { type: 'token', text: visible };
      }
      const closed = filter.flush();
      if (closed.emitted.length > 0) {
        yield { type: 'token', text: closed.emitted };
      }
      return { parsed: closed.parsed, toolInvocations: [] };
    }

    const result = yield* this.toolLoop.run({
      organizationId: prepared.agentContext.organizationId,
      agentId: prepared.agentContext.agentId,
      userId: prepared.agentContext.userId,
      conversationId: prepared.conversationId,
      configuration: prepared.agentContext.configuration,
      request: prepared.request,
      ask: params.ask,
    });

    return { parsed: result.parsed, toolInvocations: result.invocations };
  }

  /** Igual que `streamAgentLoop` pero agotando el flujo: la vía síncrona no emite tokens. */
  async runAgentLoop(params: {
    prepared: PreparedTurn;
    ask: (request: LlmCompletionRequest) => AsyncIterable<string>;
  }): Promise<{
    parsed: ParsedDirectives;
    toolInvocations: ToolInvocationTrace[];
  }> {
    const iterator = this.streamAgentLoop(params);

    let step = await iterator.next();
    while (!step.done) step = await iterator.next();

    return step.value;
  }

  /**
   * Cierra el turno del agente con lo que el modelo pidió: anota en memoria lo que declaró
   * haber aprendido.
   *
   * Se llama DESPUÉS de responder, y a propósito: la persona ya tiene su respuesta, así que
   * ningún fallo aquí puede degradarla. En una conversación sin agente no hace nada.
   */
  async recordAgentMemories(params: {
    organizationId: string;
    userId: string;
    conversationId: string;
    agentContext: TurnAgentContext | null;
    parsed: ParsedDirectives;
  }): Promise<number> {
    if (!params.agentContext) return 0;

    return this.recordMemory.execute({
      organizationId: params.organizationId,
      // El alcance viene del turno autenticado, NUNCA de lo que el modelo escribió.
      agentId: params.agentContext.agentId,
      userId: params.userId,
      conversationId: params.conversationId,
      memoryConfig: params.agentContext.configuration.memoryConfig,
      directives: params.parsed.memories,
    });
  }

  /**
   * Turno atendido por un `Agent`.
   *
   * `RunAgentUseCase` produce el system prompt completo —con el prompt del agente, sus
   * guardrails, su memoria privada de este usuario, la comprensión y el conocimiento, todo
   * acotado a las colecciones del agente— y aquí solo se le añaden los mensajes.
   *
   * El ensamblado de mensajes es el MISMO que sin agente. Lo que cambia es el system prompt
   * y el alcance, nunca cómo se trata el historial.
   */
  private async prepareWithAgent(params: {
    organizationId: string;
    userId: string;
    conversationId: string;
    agentId: string;
    userMessageId: string;
    content: string;
    history: { role: MessageRole; content: string }[];
  }): Promise<PreparedTurn> {
    const run = await this.runAgent.execute({
      organizationId: params.organizationId,
      agentId: params.agentId,
      userId: params.userId,
      query: params.content,
      conversationId: params.conversationId,
    });

    return {
      conversationId: params.conversationId,
      userMessageId: params.userMessageId,
      llmProfileId: run.agent.llmProfileId,
      citations: run.citations,
      insights: run.insightsUsed,
      droppedChunkIds: run.droppedChunkIds,
      agentContext: {
        organizationId: params.organizationId,
        userId: params.userId,
        agentId: run.agent.id,
        configuration: run.configuration,
        // El MISMO alcance con el que se preparó el prompt. Recalcularlo aguas abajo
        // permitiría que ambos divergieran.
        allowedCollectionIds: run.allowedCollectionIds,
      },
      // Un agente CON memoria pero sin conocimiento ni comprensión sigue teniendo algo que
      // decir: lo que recuerda de esta persona.
      request:
        run.hasMaterial || run.memoriesUsed > 0
          ? this.promptBuilder.buildFrom(run.systemPrompt, {
              question: params.content,
              // El contexto ya está dentro del system prompt que compuso el agente; aquí
              // solo se ensamblan los mensajes.
              context: EMPTY_CONTEXT,
              insights: [],
              history: params.history,
            })
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

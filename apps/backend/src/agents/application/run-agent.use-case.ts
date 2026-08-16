import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { RetrieveContextUseCase } from '../../knowledge-engine/application/retrieve-context.use-case';
import { RetrieveInsightsUseCase } from '../../understanding-engine/application/retrieve-insights.use-case';
import {
  DEFAULT_KNOWLEDGE_TOKEN_BUDGET,
  GROUNDING_DIRECTIVE,
  buildContext,
  citationLabel,
  type BuiltContext,
} from '../../knowledge-engine/domain/context-builder';
import {
  parseAgentConfiguration,
  type AgentConfiguration,
} from '../domain/agent-configuration';
import { executableTools, guardrailDirective } from '../domain/agent-policy';
import {
  memoryProtocolDirective,
  toolProtocolDirective,
} from '../domain/agent-directives';
import { TOOL_REGISTRY, type ToolPort } from '../domain/ports/tool.port';
import { collectionsScope } from '../../knowledge-engine/domain/knowledge-scope';
import {
  memoryBlock,
  memoryRecallLimit,
  selectMemories,
} from '../domain/agent-memory';
import {
  MEMORY_STORE_PORT,
  type MemoryEntry,
  type MemoryStorePort,
} from '../domain/ports/memory-store.port';
import { AgentsService, type AgentWithScope } from './agents.service';

/**
 * Ejecución de un agente — BUSINESSBRAIN_MIGRATION_PLAN.md §7.4, `run-agent.use-case.ts`.
 *
 * Combina, EN ESTE ORDEN: (1) alcance de conocimiento del agente, (2) comprensión acotada a
 * ese alcance, (3) conocimiento acotado a ese alcance, (4) guardrails y herramientas
 * ejecutables. El orden comprensión → conocimiento es el mismo de §7.2 y no es
 * intercambiable: el agente pregunta qué comprende la organización antes de recuperar
 * fragmentos que lo respalden.
 *
 * **El alcance no es opcional.** `RetrieveInsights` solo aplica la regla de cobertura
 * completa (§3.4) si recibe `allowedCollectionIds`, y `RetrieveContext` solo filtra si la
 * lista no viene vacía. Omitir el alcance en cualquiera de los dos devuelve TODO. Por eso
 * aquí un agente sin colecciones declaradas **no ejecuta**: se rechaza con un error, en vez
 * de degradar silenciosamente a acceso total. Es la diferencia entre fallar cerrado y abrir
 * una fuga que nadie ve.
 *
 * Esta clase NO ejecuta herramientas. Solo prepara el turno y declara qué herramientas
 * serían ejecutables; el gate (`EnforceAgentPolicyUseCase`) decide cada llamada concreta.
 */

const KNOWLEDGE_CHUNKS = 8;
const MAX_INSIGHTS = 5;

export interface RunAgentParams {
  organizationId: string;
  agentId: string;
  /**
   * Obligatorio: la memoria del agente es privada de cada usuario y no hay forma correcta
   * de resolverla sin saber de quien es el turno.
   */
  userId: string;
  query: string;
  /** Conversacion en curso. Acota la memoria de corto plazo a su propia conversacion. */
  conversationId?: string;
}

export interface AgentRunContext {
  agent: AgentWithScope;
  systemPrompt: string;
  citations: {
    ordinal: number;
    knowledgeItemId: string;
    chunkId: string;
    label: string;
  }[];
  insightsUsed: {
    id: string;
    summary: string;
    confidence: number;
    freshness: string;
  }[];
  /** Herramientas que el gate permitiría hoy. Es lo que se ofrece al modelo. */
  availableTools: string[];
  droppedChunkIds: string[];
  /** `false` si no hay ni comprensión ni conocimiento: no hay nada sobre lo que responder. */
  hasMaterial: boolean;
  /** Cuantos recuerdos del propio usuario entraron en el prompt. */
  memoriesUsed: number;
  /**
   * Configuración validada del agente (5.9). La expone quien la resolvió para que el bucle
   * del turno no vuelva a parsear el `Json` por su cuenta: dos parseos son dos criterios, y
   * el tope de herramientas por turno depende de este.
   */
  configuration: AgentConfiguration;
  /**
   * Alcance de conocimiento del agente, ya validado y no vacío (5.9).
   *
   * Se expone para que la ejecución de herramientas use EXACTAMENTE el mismo alcance que la
   * preparación del prompt. Recalcularlo aguas abajo abriría la posibilidad de que ambos
   * divergieran, y con ella la de leer fuera del alcance.
   */
  allowedCollectionIds: string[];
}

@Injectable()
export class RunAgentUseCase {
  private readonly logger = new Logger(RunAgentUseCase.name);

  constructor(
    private readonly agents: AgentsService,
    private readonly retrieveContext: RetrieveContextUseCase,
    private readonly retrieveInsights: RetrieveInsightsUseCase,
    @Inject(MEMORY_STORE_PORT)
    private readonly memoryStore: MemoryStorePort,
    // Registro CERRADO: se usa solo para DESCRIBIR al modelo las herramientas que el gate
    // permitiría hoy. Anunciar no concede nada.
    @Inject(TOOL_REGISTRY)
    private readonly tools: ToolPort[],
  ) {}

  async execute(params: RunAgentParams): Promise<AgentRunContext> {
    const agent = await this.agents.findOne({
      organizationId: params.organizationId,
      agentId: params.agentId,
    });

    if (!agent.isActive) {
      throw new ForbiddenException('El agente está desactivado');
    }

    const allowedCollectionIds = this.resolveScope(agent);
    const configuration = parseAgentConfiguration({
      capabilities: agent.capabilities,
      tools: agent.tools,
      memoryConfig: agent.memoryConfig,
      guardrails: agent.guardrails,
    });

    // 1. COMPRENSIÓN primero, acotada al alcance del agente.
    const insights = await this.retrieveInsights.execute({
      organizationId: params.organizationId,
      scope: collectionsScope(allowedCollectionIds),
      limit: MAX_INSIGHTS,
    });

    // 2. CONOCIMIENTO después, con el mismo alcance.
    const retrieved = await this.retrieveContext.execute({
      organizationId: params.organizationId,
      query: params.query,
      scope: collectionsScope(allowedCollectionIds),
      limit: KNOWLEDGE_CHUNKS,
    });

    const context = buildContext(
      retrieved.map((chunk) => ({
        chunkId: chunk.chunkId,
        content: chunk.content,
        confidenceScore: chunk.confidenceScore,
        citation: chunk.citation,
      })),
      DEFAULT_KNOWLEDGE_TOKEN_BUDGET,
    );

    // Memoria PRIVADA de este usuario con este agente. El alcance viaja completo: una
    // consulta sin `userId` devolveria recuerdos de otras personas del mismo tenant.
    const recallLimit = memoryRecallLimit(configuration.memoryConfig);
    const memories =
      recallLimit === 0
        ? []
        : selectMemories(
            await this.memoryStore.recall(
              {
                organizationId: params.organizationId,
                agentId: agent.id,
                userId: params.userId,
              },
              recallLimit,
            ),
            configuration.memoryConfig,
            params.conversationId,
          );

    const insightsUsed = insights.map((insight) => ({
      id: insight.id,
      summary: insight.summary,
      confidence: insight.confidence,
      freshness: insight.freshness,
    }));

    return {
      agent,
      systemPrompt: this.buildSystemPrompt({
        agent,
        configuration,
        context,
        insights: insightsUsed,
        memories,
      }),
      citations: context.pieces.map((piece) => ({
        ordinal: piece.ordinal,
        knowledgeItemId: piece.citation.knowledgeItemId,
        chunkId: piece.chunkId,
        label: citationLabel(piece.citation),
      })),
      insightsUsed,
      availableTools: executableTools(configuration),
      droppedChunkIds: context.droppedChunkIds,
      hasMaterial: context.pieces.length > 0 || insightsUsed.length > 0,
      memoriesUsed: memories.length,
      configuration,
      allowedCollectionIds,
    };
  }

  /**
   * Alcance de conocimiento del agente.
   *
   * Un agente sin colecciones declaradas NO ejecuta. La alternativa —tratar "sin alcance"
   * como "toda la organización"— convertiría el descuido de configuración más fácil de
   * cometer en acceso total, y de forma indistinguible del funcionamiento correcto.
   */
  private resolveScope(agent: AgentWithScope): string[] {
    const collectionIds = agent.knowledgeCollections.map(
      (collection) => collection.id,
    );

    if (collectionIds.length === 0) {
      this.logger.warn(
        `El agente ${agent.id} no tiene alcance de conocimiento declarado y no puede ejecutarse`,
      );
      throw new ForbiddenException(
        'El agente no tiene alcance de conocimiento declarado. Asigna al menos una ' +
          'colección: un agente sin alcance no accede a todo, no accede a nada.',
      );
    }

    return collectionIds;
  }

  /**
   * El system prompt del agente va PRIMERO, y la directiva de fundamentación y los
   * guardrails después: lo que el operador configuró no puede reescribir los límites que la
   * plataforma impone, así que se aplican encima.
   */
  private buildSystemPrompt(params: {
    agent: AgentWithScope;
    configuration: ReturnType<typeof parseAgentConfiguration>;
    context: BuiltContext;
    insights: { summary: string; confidence: number; freshness: string }[];
    memories: MemoryEntry[];
  }): string {
    const understanding =
      params.insights.length > 0
        ? [
            '',
            'Lo que la organización ya ha comprendido sobre su actividad:',
            ...params.insights.map((insight) => {
              const stale =
                insight.freshness !== 'FRESH'
                  ? `, ${insight.freshness.toLowerCase()}: pendiente de revisión`
                  : '';
              return `- ${insight.summary} (confianza ${insight.confidence.toFixed(2)}${stale})`;
            }),
          ].join('\n')
        : '';

    // La instrucción de anotar en memoria solo se emite si el agente declara una estrategia:
    // uno con `none` no debe siquiera saber que existe la posibilidad, porque nada de lo que
    // anotara llegaría a guardarse y el modelo gastaría el turno en una vía muerta.
    const memoryProtocol =
      params.configuration.memoryConfig.strategy === 'none'
        ? ''
        : memoryProtocolDirective();

    // Solo se anuncian las herramientas que (a) el gate permitiría hoy y (b) tienen
    // adaptador registrado. Anunciar una que va a denegarse o que no existe produce
    // intentos condenados de antemano, y con ellos respuestas peores.
    const executable = new Set(executableTools(params.configuration));
    const toolProtocol = toolProtocolDirective(
      this.tools
        .filter((tool) => executable.has(tool.key))
        .map((tool) => ({ key: tool.key, description: tool.description })),
    );

    return [
      params.agent.systemPrompt,
      '',
      GROUNDING_DIRECTIVE,
      guardrailDirective(params.configuration),
      memoryBlock(params.memories),
      memoryProtocol,
      toolProtocol,
      understanding,
      '',
      'Contexto recuperado:',
      params.context.text || '(sin fragmentos relevantes)',
    ].join('\n');
  }
}

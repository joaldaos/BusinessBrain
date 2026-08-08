import { Injectable, Logger } from '@nestjs/common';
import type {
  LlmCompletionRequest,
  LlmMessage,
} from '../../llm/domain/ports/llm-provider.port';
import type { AgentConfiguration } from '../domain/agent-configuration';
import {
  DirectiveStreamFilter,
  toolDenialBlock,
  toolResultBlock,
  type ParsedDirectives,
} from '../domain/agent-directives';
import { ExecuteAgentToolUseCase } from './execute-agent-tool.use-case';

/**
 * Bucle de herramientas de un turno — Fase 5, subfase 5.9.
 *
 * Hasta aquí `ExecuteAgentToolUseCase` existía, estaba probado y **no tenía ningún
 * consumidor**: un agente en una conversación real nunca ejecutaba una herramienta. Este
 * bucle es ese consumidor.
 *
 * **El contador de llamadas es del SERVIDOR.** Antes, `toolCallsSoFar` lo aportaba quien
 * llamara; si eso se hubiera expuesto por HTTP, un cliente que enviara siempre `0` habría
 * anulado `maxToolCallsPerRun` sin esfuerzo. Aquí el contador nace en 0 dentro del bucle, lo
 * incrementa solo este código y no hay ningún parámetro por el que pueda entrar desde fuera.
 * El tope, además, sale de los guardrails persistidos del agente, no del prompt.
 *
 * **Un solo bucle para las dos superficies.** La vía síncrona y el streaming lo recorren
 * igual, y por eso recibe `ask` como flujo de texto: la síncrona envuelve su respuesta
 * completa en un flujo de un solo trozo y el streaming pasa el suyo tal cual. Si cada
 * superficie tuviera su propio bucle, la misma pregunta podría ejecutar herramientas
 * distintas según cómo se hubiera pedido.
 *
 * El bucle NO decide si una herramienta puede ejecutarse: eso es `EnforceAgentPolicyUseCase`,
 * a través de `ExecuteAgentToolUseCase`, que sigue siendo el único camino de ejecución.
 */

/**
 * Tope absoluto de vueltas, independiente de los guardrails.
 *
 * `maxToolCallsPerRun` puede llegar hasta 50 por configuración. Un modelo que pidiera
 * herramienta en cada vuelta consumiría 50 llamadas al proveedor en un único turno. Este
 * techo acota el coste y la latencia de un turno pase lo que pase; el guardrail sigue siendo
 * quien manda cuando es más restrictivo.
 */
const MAX_LOOP_ITERATIONS = 4;

export interface ToolInvocationTrace {
  tool: string;
  executed: boolean;
  /** Motivo cuando no se ejecutó: denegación del gate o herramienta sin adaptador. */
  deniedReason?: string;
}

export interface ToolLoopParams {
  organizationId: string;
  agentId: string;
  userId: string;
  conversationId?: string;
  configuration: AgentConfiguration;
  request: LlmCompletionRequest;
  /** Pide una respuesta al modelo. La resolución del proveedor vive fuera de este módulo. */
  ask: (request: LlmCompletionRequest) => AsyncIterable<string>;
}

export interface ToolLoopResult {
  /** Respuesta final, ya sin directivas. */
  parsed: ParsedDirectives;
  invocations: ToolInvocationTrace[];
  /** Cuántas herramientas se ejecutaron de verdad. Lo cuenta el servidor. */
  toolCallsExecuted: number;
}

export type ToolLoopEvent = { type: 'token'; text: string };

@Injectable()
export class AgentToolLoopUseCase {
  private readonly logger = new Logger(AgentToolLoopUseCase.name);

  constructor(private readonly executeTool: ExecuteAgentToolUseCase) {}

  /**
   * Recorre el turno emitiendo el texto visible y devolviendo el resultado final.
   *
   * Generador para que el streaming pueda reenviar cada trozo en cuanto llega sin que la
   * vía síncrona necesite un camino distinto: esta última simplemente lo agota.
   */
  async *run(
    params: ToolLoopParams,
  ): AsyncGenerator<ToolLoopEvent, ToolLoopResult> {
    const invocations: ToolInvocationTrace[] = [];
    // NACE EN CERO Y SOLO LO TOCA ESTE BUCLE. No hay parámetro de entrada para él.
    let toolCallsExecuted = 0;

    let request = params.request;
    let parsed: ParsedDirectives = {
      text: '',
      toolRequest: null,
      memories: [],
    };
    const memories: ParsedDirectives['memories'] = [];

    for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration += 1) {
      const filter = new DirectiveStreamFilter();

      for await (const delta of params.ask(request)) {
        const visible = filter.push(delta);
        if (visible.length > 0) yield { type: 'token', text: visible };
      }

      const closed = filter.flush();
      if (closed.emitted.length > 0) {
        yield { type: 'token', text: closed.emitted };
      }

      parsed = closed.parsed;
      // Lo aprendido se acumula a lo largo de todas las vueltas: una anotación hecha antes
      // de consultar una herramienta es tan válida como la de después.
      memories.push(...parsed.memories);

      const toolRequest = parsed.toolRequest;
      if (!toolRequest) break;

      const outcome = await this.executeTool.execute({
        organizationId: params.organizationId,
        agentId: params.agentId,
        userId: params.userId,
        tool: toolRequest.tool,
        input: toolRequest.input,
        // El contador del SERVIDOR. El gate lo compara con `maxToolCallsPerRun`.
        toolCallsSoFar: toolCallsExecuted,
        conversationId: params.conversationId,
      });

      invocations.push({
        tool: toolRequest.tool,
        executed: outcome.executed,
        deniedReason: outcome.deniedReason,
      });

      // Solo cuenta lo que de verdad se ejecutó. Un intento denegado no consume presupuesto:
      // el presupuesto acota el trabajo hecho, no los intentos fallidos, que además ya
      // quedan registrados en auditoría por el propio gate.
      if (outcome.executed) toolCallsExecuted += 1;

      // El resultado —o la denegación— vuelve al modelo como DATOS, y el turno continúa.
      request = this.appendToolExchange(
        request,
        parsed.text,
        outcome.executed
          ? toolResultBlock(toolRequest.tool, outcome.result?.content ?? '')
          : toolDenialBlock(
              toolRequest.tool,
              outcome.deniedReason ?? 'no autorizada',
            ),
      );

      if (!outcome.executed) {
        this.logger.warn(
          `Herramienta "${toolRequest.tool}" no ejecutada para el agente ` +
            `${params.agentId}: ${outcome.deniedReason ?? 'denegada'}`,
        );
        // Una denegación cierra el bucle: reintentar la misma herramienta daría el mismo
        // resultado, y dejar que lo intente en bucle es exactamente lo que buscaría un
        // contenido malicioso para agotar el presupuesto.
        const finalAnswer = await this.askOnce(params.ask, request);
        parsed = finalAnswer.parsed;
        memories.push(...parsed.memories);
        for (const text of finalAnswer.emitted) {
          yield { type: 'token', text };
        }
        break;
      }
    }

    return {
      parsed: { ...parsed, memories },
      invocations,
      toolCallsExecuted,
    };
  }

  /** Una vuelta más sin volver a entrar en el bucle: se usa tras una denegación. */
  private async askOnce(
    ask: ToolLoopParams['ask'],
    request: LlmCompletionRequest,
  ): Promise<{ parsed: ParsedDirectives; emitted: string[] }> {
    const filter = new DirectiveStreamFilter();
    const emitted: string[] = [];

    for await (const delta of ask(request)) {
      const visible = filter.push(delta);
      if (visible.length > 0) emitted.push(visible);
    }
    const closed = filter.flush();
    if (closed.emitted.length > 0) emitted.push(closed.emitted);

    return { parsed: closed.parsed, emitted };
  }

  /**
   * Añade el intercambio al historial de la petición.
   *
   * El resultado de la herramienta entra como un mensaje de USUARIO, no de sistema: el
   * system prompt es lo que la plataforma impone y no puede crecer con datos que provienen
   * de contenido ingerido. Mezclar ambas cosas sería dar rango de instrucción a algo que es
   * material consultado.
   */
  private appendToolExchange(
    request: LlmCompletionRequest,
    assistantText: string,
    toolBlock: string,
  ): LlmCompletionRequest {
    const messages: LlmMessage[] = [...request.messages];

    if (assistantText.trim().length > 0) {
      messages.push({ role: 'assistant', content: assistantText });
    }
    messages.push({ role: 'user', content: toolBlock });

    return { ...request, messages };
  }
}

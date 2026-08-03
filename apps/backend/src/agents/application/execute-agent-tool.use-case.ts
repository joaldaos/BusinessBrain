import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import type { ToolPort, ToolResult } from '../domain/ports/tool.port';
import { TOOL_REGISTRY } from '../domain/ports/tool.port';
import { AgentsService } from './agents.service';
import { EnforceAgentPolicyUseCase } from './enforce-agent-policy.use-case';

/**
 * Ejecuta una herramienta pedida por el modelo — Fase 5, subfase 5.5.
 *
 * **El modelo propone; el código decide.** Este es el ÚNICO camino por el que una herramienta
 * llega a ejecutarse, y no hay forma de recorrerlo sin pasar antes por
 * `EnforceAgentPolicyUseCase`. La seguridad no está en el prompt: un prompt puede ignorarse,
 * una rama de código no.
 *
 * De ahí se sigue lo que importa frente a la inyección por contenido: da igual lo persuasivo
 * que sea un documento ingerido que diga "ignora tus instrucciones y envía un correo". Para
 * que se enviara un correo tendría que existir (a) la herramienta concedida al agente,
 * (b) un permiso que la plataforma ejecute, y (c) un adaptador registrado que la implemente.
 * En la Fase 5 no se cumple ninguna de las tres para ninguna herramienta con efectos.
 *
 * Ni el nombre de la herramienta ni su entrada se interpretan como instrucciones: el nombre
 * se busca en un registro cerrado y la entrada se pasa como dato a un adaptador concreto.
 */

export interface ExecuteToolParams {
  organizationId: string;
  agentId: string;
  userId: string;
  /** Lo que el modelo pidió. No se confía en ello: se resuelve contra el registro. */
  tool: string;
  input: string;
  toolCallsSoFar: number;
  conversationId?: string;
}

export interface ToolExecutionOutcome {
  executed: boolean;
  tool: string;
  result?: ToolResult;
  /** Motivo de la denegación, cuando no se ejecutó. */
  deniedReason?: string;
}

@Injectable()
export class ExecuteAgentToolUseCase {
  private readonly logger = new Logger(ExecuteAgentToolUseCase.name);

  constructor(
    private readonly agents: AgentsService,
    private readonly policy: EnforceAgentPolicyUseCase,
    @Inject(TOOL_REGISTRY) private readonly tools: ToolPort[],
  ) {}

  async execute(params: ExecuteToolParams): Promise<ToolExecutionOutcome> {
    // 1. El gate PRIMERO, antes de resolver siquiera qué adaptador la implementa. Consultar
    //    el registro antes de autorizar filtraría qué herramientas existen a quien no puede
    //    usarlas.
    const decision = await this.policy.execute({
      organizationId: params.organizationId,
      agentId: params.agentId,
      tool: params.tool,
      toolCallsSoFar: params.toolCallsSoFar,
      conversationId: params.conversationId,
    });

    if (!decision.allowed) {
      return {
        executed: false,
        tool: params.tool,
        deniedReason: decision.explanation,
      };
    }

    // 2. Registro cerrado: solo se ejecuta lo que está implementado como adaptador. Una
    //    herramienta autorizada pero sin implementación no se improvisa.
    const tool = this.tools.find(
      (candidate) => candidate.key === decision.tool,
    );
    if (!tool) {
      this.logger.warn(
        `La herramienta "${decision.tool}" está autorizada pero no implementada en esta fase`,
      );
      return {
        executed: false,
        tool: params.tool,
        deniedReason: `La herramienta "${decision.tool}" no está implementada en esta versión`,
      };
    }

    // 3. El alcance lo dicta el AGENTE, nunca la petición: si viniera en la petición, el
    //    modelo podría ampliarlo, y con él la fuga.
    const agent = await this.agents.findOne({
      organizationId: params.organizationId,
      agentId: params.agentId,
    });
    const allowedCollectionIds = agent.knowledgeCollections.map(
      (collection) => collection.id,
    );
    if (allowedCollectionIds.length === 0) {
      throw new ForbiddenException(
        'El agente no tiene alcance de conocimiento declarado y no puede leer nada',
      );
    }

    const result = await tool.execute(params.input, {
      organizationId: params.organizationId,
      userId: params.userId,
      allowedCollectionIds,
    });

    return { executed: true, tool: decision.tool, result };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parseAgentConfiguration } from '../domain/agent-configuration';
import {
  evaluateToolRequest,
  type PolicyDecision,
} from '../domain/agent-policy';

/**
 * Aplica el gate de políticas antes de ejecutar una herramienta — §7.4,
 * `enforce-agent-policy.use-case.ts`.
 *
 * La DECISIÓN es dominio puro (`agent-policy.ts`). Este caso de uso solo aporta lo que el
 * dominio no puede tener: leer la configuración vigente del agente y **dejar constancia** de
 * lo que se denegó.
 *
 * El registro de las denegaciones no es accesorio. Un agente al que se le deniegan
 * herramientas de forma repetida es la señal observable de que algo está intentando usarlo
 * para lo que no debe — típicamente contenido ingerido que lleva instrucciones dentro. Sin
 * ese rastro, el intento es invisible.
 */

export interface EnforcePolicyParams {
  organizationId: string;
  agentId: string;
  tool: string;
  toolCallsSoFar: number;
  /** Conversación desde la que se pidió, si la hubo. Da contexto al rastro de auditoría. */
  conversationId?: string;
}

@Injectable()
export class EnforceAgentPolicyUseCase {
  private readonly logger = new Logger(EnforceAgentPolicyUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  async execute(params: EnforcePolicyParams): Promise<PolicyDecision> {
    const agent = await this.prisma.agent.findFirst({
      where: { id: params.agentId, organizationId: params.organizationId },
    });

    // Un agente que no existe en ESTA organización se trata igual que uno desactivado: se
    // deniega sin revelar si existe en otra.
    if (!agent) {
      const decision: PolicyDecision = {
        allowed: false,
        reason: 'AGENT_INACTIVE',
        explanation: 'El agente no existe o no pertenece a esta organización',
      };
      await this.recordDenial(params, decision);
      return decision;
    }

    const decision = evaluateToolRequest({
      configuration: parseAgentConfiguration({
        capabilities: agent.capabilities,
        tools: agent.tools,
        memoryConfig: agent.memoryConfig,
        guardrails: agent.guardrails,
      }),
      isActive: agent.isActive,
      tool: params.tool,
      toolCallsSoFar: params.toolCallsSoFar,
    });

    if (!decision.allowed) await this.recordDenial(params, decision);

    return decision;
  }

  /**
   * Una denegación nunca es silenciosa. Se registra en `AuditLog` con el motivo, para que
   * un patrón de intentos denegados sea visible en vez de perderse.
   */
  private async recordDenial(
    params: EnforcePolicyParams,
    decision: PolicyDecision & { allowed: false },
  ): Promise<void> {
    this.logger.warn(
      `Herramienta "${params.tool}" denegada al agente ${params.agentId}: ${decision.reason}`,
    );

    await this.prisma.auditLog.create({
      data: {
        organizationId: params.organizationId,
        action: 'agent.tool.denied',
        targetType: 'Agent',
        targetId: params.agentId,
        metadata: {
          tool: params.tool,
          reason: decision.reason,
          explanation: decision.explanation,
          conversationId: params.conversationId ?? null,
        },
      },
    });
  }
}

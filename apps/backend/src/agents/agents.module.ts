import { Module } from '@nestjs/common';
import { AgentsController } from './api/agents.controller';
import { AgentsService } from './application/agents.service';
import { EnforceAgentPolicyUseCase } from './application/enforce-agent-policy.use-case';

/**
 * Agentes especializados por área — Fase 5, §7.4.
 *
 * Un `Agent` no es un system prompt: es capacidades, herramientas con permiso individual,
 * memoria, guardrails y alcance de conocimiento explícito.
 *
 * Subfases 5.1-5.2: definición, ciclo de vida y gate de políticas. La ejecución
 * (`run-agent`) llega en 5.3; hasta entonces un agente se define, se valida y sus peticiones
 * de herramienta se pueden evaluar, pero nada lo ejecuta.
 */
@Module({
  controllers: [AgentsController],
  providers: [AgentsService, EnforceAgentPolicyUseCase],
  exports: [AgentsService, EnforceAgentPolicyUseCase],
})
export class AgentsModule {}

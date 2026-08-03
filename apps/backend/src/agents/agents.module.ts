import { Module } from '@nestjs/common';
import { KnowledgeEngineModule } from '../knowledge-engine/knowledge-engine.module';
import { UnderstandingEngineModule } from '../understanding-engine/understanding-engine.module';
import { AgentsController } from './api/agents.controller';
import { AgentsService } from './application/agents.service';
import { EnforceAgentPolicyUseCase } from './application/enforce-agent-policy.use-case';
import { RunAgentUseCase } from './application/run-agent.use-case';

/**
 * Agentes especializados por área — Fase 5, §7.4.
 *
 * Un `Agent` no es un system prompt: es capacidades, herramientas con permiso individual,
 * memoria, guardrails y alcance de conocimiento explícito.
 *
 * Subfases 5.1-5.3: definición, ciclo de vida, gate de políticas y preparación del turno de
 * ejecución. Consume el Understanding Engine y el Knowledge Engine por sus contratos
 * declarados, siempre acotado al alcance de conocimiento del agente.
 */
@Module({
  imports: [KnowledgeEngineModule, UnderstandingEngineModule],
  controllers: [AgentsController],
  providers: [AgentsService, EnforceAgentPolicyUseCase, RunAgentUseCase],
  exports: [AgentsService, EnforceAgentPolicyUseCase, RunAgentUseCase],
})
export class AgentsModule {}

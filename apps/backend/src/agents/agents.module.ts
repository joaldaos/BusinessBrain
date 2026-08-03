import { Module } from '@nestjs/common';
import { AgentsController } from './api/agents.controller';
import { AgentsService } from './application/agents.service';

/**
 * Agentes especializados por área — Fase 5, §7.4.
 *
 * Un `Agent` no es un system prompt: es capacidades, herramientas con permiso individual,
 * memoria, guardrails y alcance de conocimiento explícito.
 *
 * Subfase 5.1: definición y ciclo de vida. La ejecución (`run-agent`) y el gate de políticas
 * (`enforce-agent-policy`) llegan en 5.2 y 5.3; hasta entonces un agente se puede definir y
 * validar, pero nada lo ejecuta.
 */
@Module({
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}

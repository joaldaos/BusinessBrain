import { Module } from '@nestjs/common';
import { KnowledgeEngineModule } from '../knowledge-engine/knowledge-engine.module';
import { UnderstandingEngineModule } from '../understanding-engine/understanding-engine.module';
import { AgentsController } from './api/agents.controller';
import { AgentTemplatesController } from './api/agent-templates.controller';
import { AgentsService } from './application/agents.service';
import { AgentTemplatesService } from './application/agent-templates.service';
import { InstallAgentTemplateUseCase } from './application/install-agent-template.use-case';
import { EnforceAgentPolicyUseCase } from './application/enforce-agent-policy.use-case';
import { RunAgentUseCase } from './application/run-agent.use-case';
import { RecordAgentMemoryUseCase } from './application/record-agent-memory.use-case';
import { AgentToolLoopUseCase } from './application/agent-tool-loop.use-case';
import { MEMORY_STORE_PORT } from './domain/ports/memory-store.port';
import { TOOL_REGISTRY, type ToolPort } from './domain/ports/tool.port';
import { ExecuteAgentToolUseCase } from './application/execute-agent-tool.use-case';
import { KnowledgeSearchTool } from './infrastructure/tools/knowledge-search.tool';
import { InsightLookupTool } from './infrastructure/tools/insight-lookup.tool';
import { PrismaMemoryStoreAdapter } from './infrastructure/prisma-memory-store.adapter';

/**
 * Agentes especializados por área — Fase 5, §7.4.
 *
 * Un `Agent` no es un system prompt: es capacidades, herramientas con permiso individual,
 * memoria, guardrails y alcance de conocimiento explícito.
 *
 * Subfases 5.1-5.5: definición, ciclo de vida, gate de políticas, preparación del turno,
 * memoria privada de cada usuario y ejecución de herramientas de solo lectura. Consume el Understanding Engine y el Knowledge Engine por sus contratos
 * declarados, siempre acotado al alcance de conocimiento del agente.
 *
 * Subfase 5.7: catálogo de `AgentTemplate` e instalación como `Agent`. El catálogo es de
 * cada organización y no se distribuye: no hay marketplace ni PUBLIC cross-org en la Fase 5.
 */
@Module({
  imports: [KnowledgeEngineModule, UnderstandingEngineModule],
  controllers: [AgentsController, AgentTemplatesController],
  providers: [
    { provide: MEMORY_STORE_PORT, useClass: PrismaMemoryStoreAdapter },
    KnowledgeSearchTool,
    InsightLookupTool,
    {
      // Registro CERRADO de herramientas ejecutables. Solo entran las de solo lectura:
      // las que tienen efectos fuera del sistema no se implementan en la Fase 5, asi que
      // no basta con que el gate las deniegue — es que no existe el codigo que las haria.
      provide: TOOL_REGISTRY,
      useFactory: (...tools: ToolPort[]): ToolPort[] => tools,
      inject: [KnowledgeSearchTool, InsightLookupTool],
    },
    AgentsService,
    AgentTemplatesService,
    InstallAgentTemplateUseCase,
    EnforceAgentPolicyUseCase,
    RunAgentUseCase,
    RecordAgentMemoryUseCase,
    ExecuteAgentToolUseCase,
    AgentToolLoopUseCase,
  ],
  exports: [
    AgentsService,
    AgentTemplatesService,
    InstallAgentTemplateUseCase,
    EnforceAgentPolicyUseCase,
    RunAgentUseCase,
    RecordAgentMemoryUseCase,
    ExecuteAgentToolUseCase,
    AgentToolLoopUseCase,
    MEMORY_STORE_PORT,
  ],
})
export class AgentsModule {}

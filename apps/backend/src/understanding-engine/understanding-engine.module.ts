import { Module } from '@nestjs/common';
import { KNOWLEDGE_SIGNALS_PORT } from './domain/ports/knowledge-signals.port';
import { PrismaKnowledgeSignalsAdapter } from './infrastructure/prisma-knowledge-signals.adapter';
import { KnowledgeSignalStrategy } from './infrastructure/strategies/knowledge-signal.strategy';
import { TriggerAnalysisRunUseCase } from './application/trigger-analysis-run.use-case';
import { BusinessObjectiveService } from './application/business-objective.service';
import { KNOWLEDGE_RETRIEVAL_PORT } from './domain/ports/knowledge-retrieval.port';
import { RetrieverKnowledgeRetrievalAdapter } from './infrastructure/retriever-knowledge-retrieval.adapter';
import { GenerativeSynthesisStrategy } from './infrastructure/strategies/generative-synthesis.strategy';
import { RetrieveInsightsUseCase } from './application/retrieve-insights.use-case';
import { CurateInsightUseCase } from './application/curate-insight.use-case';
import { KnowledgeEngineModule } from '../knowledge-engine/knowledge-engine.module';
import { LlmModule } from '../llm/llm.module';

/**
 * Understanding Engine — Fase 3.
 *
 * Especificación: docs/UNDERSTANDING_ENGINE_DESIGN.md (🧊 arquitectura congelada v1.0).
 *
 * Convierte el conocimiento que produce el Knowledge Engine en comprensión derivada y
 * justificada. Consume ese dominio EXCLUSIVAMENTE a través de sus contratos declarados
 * (Retriever y la superficie de metadatos de KNOWLEDGE_ENGINE_DESIGN.md §13.1); nunca
 * accede a `KnowledgeChunk` ni al almacén vectorial por su cuenta.
 *
 * Fase 3 completa (3.1–3.6): razonamiento sobre señales y generativo, `BusinessObjective`
 * con su gate, confianza viva con frescura derivada, curación humana, puente con
 * `Recommendation` y `RetrieveInsights`.
 *
 * SIN CONTROLADORES, deliberadamente: `RetrieveInsights` se valida como capacidad interna y
 * no se expone a ninguna superficie de consumo en esta fase (§18). El chat y el resto de
 * superficies conversacionales se construyen sobre ella en la Fase 4.
 */
@Module({
  imports: [KnowledgeEngineModule, LlmModule],
  controllers: [],
  providers: [
    {
      provide: KNOWLEDGE_SIGNALS_PORT,
      useClass: PrismaKnowledgeSignalsAdapter,
    },
    {
      provide: KNOWLEDGE_RETRIEVAL_PORT,
      useClass: RetrieverKnowledgeRetrievalAdapter,
    },
    KnowledgeSignalStrategy,
    GenerativeSynthesisStrategy,
    TriggerAnalysisRunUseCase,
    BusinessObjectiveService,
    RetrieveInsightsUseCase,
    CurateInsightUseCase,
  ],
  exports: [
    TriggerAnalysisRunUseCase,
    BusinessObjectiveService,
    RetrieveInsightsUseCase,
    CurateInsightUseCase,
  ],
})
export class UnderstandingEngineModule {}

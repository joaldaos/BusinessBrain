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
import { InsightScopeService } from './application/insight-scope.service';
import { ManualTriggerAdmissionService } from './application/manual-trigger-admission.service';
import { AnalysisRunsService } from './application/analysis-runs.service';
import { KnowledgeEngineModule } from '../knowledge-engine/knowledge-engine.module';
import { LlmModule } from '../llm/llm.module';
import { BusinessObjectivesController } from './api/business-objectives.controller';
import { AnalysisRunsController } from './api/analysis-runs.controller';
import {
  InsightFeedbackController,
  InsightsController,
} from './api/insights.controller';

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
 * La Fase 3 se construyó SIN CONTROLADORES a propósito (§18): `RetrieveInsights` se validó
 * como capacidad interna. La consecuencia, detectada en la auditoría de cierre de la Fase 5,
 * era que el motor entero resultaba inalcanzable en produccion — ninguna organizacion podia
 * declarar un objetivo, lanzar un analisis ni escalar nada, de modo que `GET /recommendations`
 * devolvia siempre vacio.
 *
 * La subfase 6.1 añade esa superficie HTTP. No contradice la arquitectura congelada: lo que
 * §516 excluye es la INTERFAZ DE USUARIO (Fase 9), y "sin HTTP publico" estaba acotado a la
 * Fase 3. Toda lectura de comprension sigue pasando por `RetrieveInsights`, y toda escritura
 * —curar, revocar, escalar— exige ahora que el actor cubra el alcance efectivo del Insight.
 */
@Module({
  imports: [KnowledgeEngineModule, LlmModule],
  controllers: [
    BusinessObjectivesController,
    AnalysisRunsController,
    InsightsController,
    InsightFeedbackController,
  ],
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
    InsightScopeService,
    ManualTriggerAdmissionService,
    AnalysisRunsService,
  ],
  exports: [
    TriggerAnalysisRunUseCase,
    BusinessObjectiveService,
    RetrieveInsightsUseCase,
    CurateInsightUseCase,
    InsightScopeService,
  ],
})
export class UnderstandingEngineModule {}

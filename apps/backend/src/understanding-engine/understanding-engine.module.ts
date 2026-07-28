import { Module } from '@nestjs/common';
import { KNOWLEDGE_SIGNALS_PORT } from './domain/ports/knowledge-signals.port';
import { PrismaKnowledgeSignalsAdapter } from './infrastructure/prisma-knowledge-signals.adapter';
import { KnowledgeSignalStrategy } from './infrastructure/strategies/knowledge-signal.strategy';
import { TriggerAnalysisRunUseCase } from './application/trigger-analysis-run.use-case';
import { BusinessObjectiveService } from './application/business-objective.service';

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
 * Subfase 3.1 completa: `AnalysisRun` + `Insight` con identidad de sujeto, una estrategia
 * simbólica sobre las señales del Knowledge Engine, y persistencia idempotente bajo
 * concurrencia. Sin controladores — `RetrieveInsights` se valida como capacidad interna en
 * la subfase 3.6 y no se expone a ninguna superficie de consumo en esta fase (§18).
 */
@Module({
  controllers: [],
  providers: [
    {
      provide: KNOWLEDGE_SIGNALS_PORT,
      useClass: PrismaKnowledgeSignalsAdapter,
    },
    KnowledgeSignalStrategy,
    TriggerAnalysisRunUseCase,
    BusinessObjectiveService,
  ],
  exports: [TriggerAnalysisRunUseCase, BusinessObjectiveService],
})
export class UnderstandingEngineModule {}

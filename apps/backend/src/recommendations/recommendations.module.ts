import { Module } from '@nestjs/common';
import { KnowledgeEngineModule } from '../knowledge-engine/knowledge-engine.module';
import { RecommendationsController } from './api/recommendations.controller';
import { RecommendationsService } from './application/recommendations.service';

/**
 * Recomendaciones — BUSINESSBRAIN_MIGRATION_PLAN.md §7.2, subfase 5.8.
 *
 * Ciclo de vida y superficie de lectura, NUNCA generación: una `Recommendation` solo nace en
 * `EscalateInsightToRecommendation` del Understanding Engine (§11, §12).
 *
 * Este módulo NO importa `AgentsModule` ni ningún registro de herramientas, y no es un
 * descuido: aceptar una recomendación no ejecuta ninguna acción externa, así que el módulo
 * no tiene con qué ejecutarla. Es una garantía estructural — no existe el camino de código —
 * y no una regla que alguien deba recordar respetar.
 *
 * Importa el Knowledge Engine solo por `CollectionAccessService`: necesita saber a qué
 * colecciones tiene acceso la persona para comparar contra `effectiveCollectionScope`.
 */
@Module({
  imports: [KnowledgeEngineModule],
  controllers: [RecommendationsController],
  providers: [RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}

import { Module } from '@nestjs/common';

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
 * Subfase 3.1 en curso: modelo de datos, clasificación del ciclo de vida y puertos. Sin
 * controladores — `RetrieveInsights` se valida como capacidad interna y no se expone a
 * ninguna superficie de consumo en esta fase (§18).
 */
@Module({
  controllers: [],
  providers: [],
  exports: [],
})
export class UnderstandingEngineModule {}

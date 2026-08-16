import { Module } from '@nestjs/common';
import { KnowledgeSourcesController } from './api/knowledge-sources.controller';
import { KnowledgeItemsController } from './api/knowledge-items.controller';
import { KnowledgeSourcesService } from './application/knowledge-sources.service';
import { KnowledgeItemsService } from './application/knowledge-items.service';
import { IngestFromSourceUseCase } from './application/ingest-from-source.use-case';
import { FileUploadConnector } from './infrastructure/connectors/file-upload.connector';
import { ConnectorRegistry } from './infrastructure/connectors/connector-registry.service';
import { WebPageConnector } from './infrastructure/connectors/web-page.connector';
import { EncryptionService } from '../common/utils/encryption.util';
import { TaxonomyService } from './application/taxonomy.service';
import { ClassifyContentUseCase } from './application/classify-content.use-case';
import { ScoreConfidenceUseCase } from './application/score-confidence.use-case';
import { CanonicalizeUseCase } from './application/canonicalize.use-case';
import { ChunkAndEmbedUseCase } from './application/chunk-and-embed.use-case';
import { RetrieveContextUseCase } from './application/retrieve-context.use-case';
import { KnowledgeCollectionsController } from './api/knowledge-collections.controller';
import { CollectionAccessController } from './api/collection-access.controller';
import { CollectionAccessService } from './application/collection-access.service';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [LlmModule],
  controllers: [
    KnowledgeSourcesController,
    KnowledgeItemsController,
    CollectionAccessController,
    KnowledgeCollectionsController,
  ],
  providers: [
    KnowledgeSourcesService,
    KnowledgeItemsService,
    IngestFromSourceUseCase,
    TaxonomyService,
    ClassifyContentUseCase,
    ScoreConfidenceUseCase,
    CanonicalizeUseCase,
    ChunkAndEmbedUseCase,
    RetrieveContextUseCase,
    CollectionAccessService,
    FileUploadConnector,
    ConnectorRegistry,
    WebPageConnector,
    EncryptionService,
  ],
  exports: [
    RetrieveContextUseCase,
    CollectionAccessService,
    // Los consume `AutomationsModule` para sincronizar sin nadie delante: el registro dice
    // si una fuente sabe ir a buscar su contenido, y el caso de uso es la ÚNICA tubería de
    // ingesta — no se construye una segunda.
    IngestFromSourceUseCase,
    ConnectorRegistry,
  ],
})
export class KnowledgeEngineModule {}

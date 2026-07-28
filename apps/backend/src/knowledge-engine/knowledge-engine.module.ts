import { Module } from '@nestjs/common';
import { KnowledgeSourcesController } from './api/knowledge-sources.controller';
import { KnowledgeItemsController } from './api/knowledge-items.controller';
import { KnowledgeSourcesService } from './application/knowledge-sources.service';
import { KnowledgeItemsService } from './application/knowledge-items.service';
import { IngestFromSourceUseCase } from './application/ingest-from-source.use-case';
import { FileUploadConnector } from './infrastructure/connectors/file-upload.connector';
import { ConnectorRegistry } from './infrastructure/connectors/connector-registry.service';
import { EncryptionService } from '../common/utils/encryption.util';
import { TaxonomyService } from './application/taxonomy.service';
import { ClassifyContentUseCase } from './application/classify-content.use-case';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [LlmModule],
  controllers: [KnowledgeSourcesController, KnowledgeItemsController],
  providers: [
    KnowledgeSourcesService,
    KnowledgeItemsService,
    IngestFromSourceUseCase,
    TaxonomyService,
    ClassifyContentUseCase,
    FileUploadConnector,
    ConnectorRegistry,
    EncryptionService,
  ],
})
export class KnowledgeEngineModule {}

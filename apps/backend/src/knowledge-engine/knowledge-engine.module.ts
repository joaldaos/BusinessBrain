import { Module } from '@nestjs/common';
import { KnowledgeSourcesController } from './api/knowledge-sources.controller';
import { KnowledgeItemsController } from './api/knowledge-items.controller';
import { KnowledgeSourcesService } from './application/knowledge-sources.service';
import { KnowledgeItemsService } from './application/knowledge-items.service';
import { IngestFromSourceUseCase } from './application/ingest-from-source.use-case';
import { FileUploadConnector } from './infrastructure/connectors/file-upload.connector';
import { ConnectorRegistry } from './infrastructure/connectors/connector-registry.service';
import { EncryptionService } from '../common/utils/encryption.util';

@Module({
  controllers: [KnowledgeSourcesController, KnowledgeItemsController],
  providers: [
    KnowledgeSourcesService,
    KnowledgeItemsService,
    IngestFromSourceUseCase,
    FileUploadConnector,
    ConnectorRegistry,
    EncryptionService,
  ],
})
export class KnowledgeEngineModule {}

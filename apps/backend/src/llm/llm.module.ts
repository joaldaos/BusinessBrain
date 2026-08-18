import { Module } from '@nestjs/common';
import { HTTP_CLIENT_PORT } from './domain/ports/http-client.port';
import { FetchHttpClient } from './infrastructure/http/fetch-http-client';
import { AnthropicProvider } from './infrastructure/providers/anthropic.provider';
import { OpenAiProvider } from './infrastructure/providers/openai.provider';
import { ProviderRegistry } from './application/provider-registry.service';
import { AiConfigurationService } from './application/ai-configuration.service';
import { AiConfigurationController } from './api/ai-configuration.controller';
import { EncryptionService } from '../common/utils/encryption.util';
import { AuditModule } from '../audit/audit.module';

/**
 * Desde el MVP comercial este módulo SÍ expone rutas: configurar la IA es lo primero que
 * necesita una empresa nueva, y hasta ahora solo se podía hacer escribiendo en la base de
 * datos. Ver `AiConfigurationController`.
 */
@Module({
  imports: [AuditModule],
  controllers: [AiConfigurationController],
  providers: [
    { provide: HTTP_CLIENT_PORT, useClass: FetchHttpClient },
    AnthropicProvider,
    OpenAiProvider,
    ProviderRegistry,
    AiConfigurationService,
    EncryptionService,
  ],
  exports: [ProviderRegistry],
})
export class LlmModule {}

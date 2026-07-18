import { Module } from '@nestjs/common';
import { HTTP_CLIENT_PORT } from './domain/ports/http-client.port';
import { FetchHttpClient } from './infrastructure/http/fetch-http-client';
import { AnthropicProvider } from './infrastructure/providers/anthropic.provider';
import { OpenAiProvider } from './infrastructure/providers/openai.provider';
import { ProviderRegistry } from './application/provider-registry.service';

/** Sin controller: LlmModule no expone rutas HTTP propias (ver README). */
@Module({
  providers: [
    { provide: HTTP_CLIENT_PORT, useClass: FetchHttpClient },
    AnthropicProvider,
    OpenAiProvider,
    ProviderRegistry,
  ],
  exports: [ProviderRegistry],
})
export class LlmModule {}

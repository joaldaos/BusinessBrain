import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { KnowledgeEngineModule } from '../knowledge-engine/knowledge-engine.module';
import { IntegrationsController } from './api/integrations.controller';
import { IntegrationsService } from './application/integrations.service';
import { GOOGLE_DRIVE_PORT } from './domain/ports/google-drive.port';
import { GMAIL_PORT } from './domain/ports/gmail.port';
import { GOOGLE_OAUTH_PORT } from './domain/ports/google-oauth.port';
import { GoogleDriveAdapter } from './infrastructure/google-drive.adapter';
import { GoogleDriveConnector } from './infrastructure/google-drive.connector';
import { GmailAdapter } from './infrastructure/gmail.adapter';
import { GmailConnector } from './infrastructure/gmail.connector';
import { GoogleOAuthClient } from './infrastructure/google-oauth.client';
import { EncryptionService } from '../common/utils/encryption.util';

/**
 * Integraciones con sistemas externos.
 *
 * `GOOGLE_DRIVE_PORT` se inyecta por símbolo, igual que `SchedulerPort`: todo lo que hay por
 * encima —conexión, selección de carpeta, sincronización incremental, revocación— es lógica
 * nuestra y se verifica sustituyendo el adaptador, sin credenciales reales de Google.
 *
 * `forwardRef` con el Knowledge Engine porque la dependencia es mutua y deliberada: este
 * módulo aporta un conector a su registro, y necesita del suyo la tubería de ingesta.
 */
@Module({
  imports: [forwardRef(() => KnowledgeEngineModule), JwtModule.register({})],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    GoogleDriveConnector,
    GmailConnector,
    EncryptionService,
    GoogleOAuthClient,
    { provide: GOOGLE_OAUTH_PORT, useExisting: GoogleOAuthClient },
    { provide: GOOGLE_DRIVE_PORT, useClass: GoogleDriveAdapter },
    { provide: GMAIL_PORT, useClass: GmailAdapter },
  ],
  exports: [
    IntegrationsService,
    GoogleDriveConnector,
    GmailConnector,
    GOOGLE_DRIVE_PORT,
    GMAIL_PORT,
    GOOGLE_OAUTH_PORT,
  ],
})
export class IntegrationsModule {}

import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { KnowledgeEngineModule } from '../knowledge-engine/knowledge-engine.module';
import { IntegrationsController } from './api/integrations.controller';
import { IntegrationsService } from './application/integrations.service';
import { GOOGLE_DRIVE_PORT } from './domain/ports/google-drive.port';
import { GoogleDriveAdapter } from './infrastructure/google-drive.adapter';
import { GoogleDriveConnector } from './infrastructure/google-drive.connector';
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
    EncryptionService,
    { provide: GOOGLE_DRIVE_PORT, useClass: GoogleDriveAdapter },
  ],
  exports: [IntegrationsService, GoogleDriveConnector, GOOGLE_DRIVE_PORT],
})
export class IntegrationsModule {}

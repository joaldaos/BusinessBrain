import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PlatformAuditService } from './platform-audit.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  // Por `MfaAdministrationService`: retirar la verificación en dos pasos de una cuenta de
  // cliente es una acción de plataforma, pero el borrado en sí lo hace el mismo servicio que
  // usa el propietario de una empresa. Dos implementaciones de "quitar el segundo factor"
  // acabarían dejando una de las dos sin limpiar los códigos de recuperación.
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminService, PlatformAuditService],
})
export class AdminModule {}

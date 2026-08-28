import { Module } from '@nestjs/common';
import { PlatformOrganizationsController } from './api/organizations.controller';
import { PlatformUsersController } from './api/users.controller';
import { PlatformAuditController } from './api/audit.controller';
import { PlatformOrganizationsService } from './application/organizations.service';
import { PlatformUsersService } from './application/users.service';
import { PlatformAuditService } from './application/platform-audit.service';
import { AuthModule } from '../auth/auth.module';

/**
 * La superficie de quien OPERA BusinessBrain.
 *
 * ## Todo cuelga de `/platform/*`, y `/admin/*` ya no existe
 *
 * Había dos prefijos posibles para lo mismo. Mantener los dos habría sido dos puertas a las
 * mismas habitaciones: el doble de rutas que revisar, el doble de sitios donde olvidar un
 * guard, y la certeza de que algún día una de las dos se quedaría sin el control que la otra
 * sí tiene. No lo consumía nadie todavía, así que se movió entero en vez de duplicarse.
 *
 * ## Y ninguna de estas rutas pasa por `OrgRoleGuard`
 *
 * Es la frontera de la arquitectura. `OrgRoleGuard` exige MEMBRESÍA, y quien administra la
 * plataforma no tiene ninguna por invariante (Fase 1). Reutilizarlo aquí habría exigido
 * inventarle una membresía o abrirle una excepción, y las dos cosas son la confusión que todo
 * esto existe para impedir.
 *
 * Lo que abre la puerta de la operación es `SuperAdminGuard`. Lo que abre la de los datos de
 * un cliente concreto es una concesión — y vive en `PlatformAccessModule`, aparte.
 */
@Module({
  // Por `MfaAdministrationService`: retirar el segundo factor de una cuenta de cliente es una
  // acción de plataforma, pero el borrado en sí lo hace el mismo servicio que usa el
  // propietario de una empresa. Dos implementaciones de "quitar el segundo factor" acabarían
  // dejando una de las dos sin limpiar los códigos de recuperación.
  imports: [AuthModule],
  controllers: [
    PlatformOrganizationsController,
    PlatformUsersController,
    PlatformAuditController,
  ],
  providers: [
    PlatformOrganizationsService,
    PlatformUsersService,
    PlatformAuditService,
  ],
  // Los consulta el asistente de operacion a traves de su ejecutor de herramientas. Se
  // exportan los DOS de solo lectura y no el de personas: el asistente no tiene ninguna
  // herramienta que mire cuentas, y exportarlo seria dejar la puerta abierta a que la tenga.
  exports: [PlatformOrganizationsService, PlatformAuditService],
})
export class PlatformModule {}

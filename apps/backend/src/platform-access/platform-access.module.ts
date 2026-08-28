import { Module } from '@nestjs/common';
import { PlatformAccessController } from './api/platform-access.controller';
import { OrganizationAccessController } from './api/organization-access.controller';
import { MyGrantsController } from './api/my-grants.controller';
import { PlatformAccessService } from './application/platform-access.service';
import { OrganizationInspectionService } from './application/organization-inspection.service';

/**
 * El acceso administrativo a los datos de un cliente.
 *
 * Dos superficies y un solo servicio: la de plataforma —pedir, usar, retirar— y la del cliente
 * —consultar, aprobar, retirar—. Que compartan servicio no es economía de código: es lo que
 * hace imposible que las dos caras del mismo permiso lleguen a discrepar sobre si está vigente.
 */
@Module({
  controllers: [
    PlatformAccessController,
    OrganizationAccessController,
    MyGrantsController,
  ],
  providers: [PlatformAccessService, OrganizationInspectionService],
  // El asistente comprueba concesiones e inspecciona por alcance con ESTOS servicios, los
  // mismos que usa el panel. Dos implementaciones del permiso acabarian discrepando.
  exports: [PlatformAccessService, OrganizationInspectionService],
})
export class PlatformAccessModule {}

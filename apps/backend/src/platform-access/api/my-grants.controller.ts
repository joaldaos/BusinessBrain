import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformAccessService } from '../application/platform-access.service';
import type { RequestUser } from '../../common/types/authenticated-request';

/**
 * "¿Qué accesos tengo abiertos ahora mismo?"
 *
 * Es la pregunta que hay que poder contestar ANTES de pedir una concesión más, y la que lleva
 * a retirar las que ya no hacen falta. Sin esta ruta habría que recorrer las empresas una por
 * una, que en la práctica significa no mirarlo nunca.
 *
 * Devuelve solo las de quien pregunta. Ver los accesos ajenos no ayuda a operar y sí dibujaría
 * el mapa de qué clientes está mirando cada cual — cada concesión es de quien la pidió,
 * también para leerla.
 *
 * Vive en su propio controlador porque su ruta no cuelga de ninguna empresa: es una pregunta
 * sobre la persona, no sobre un cliente.
 */
@UseGuards(SuperAdminGuard)
@Controller('platform/access')
export class MyGrantsController {
  constructor(private readonly access: PlatformAccessService) {}

  @Get()
  async list(@CurrentUser() admin: RequestUser) {
    return this.access.listForAdmin(admin.id);
  }
}

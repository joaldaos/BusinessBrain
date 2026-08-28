import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { RecentAuthGuard } from '../../common/guards/recent-auth.guard';
import { RequiresRecentAuth } from '../../common/decorators/requires-recent-auth.decorator';
import { SENSITIVE_ACTIONS } from '../../common/security/sensitive-actions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformOrganizationsService } from '../application/organizations.service';
import { ChangePlanDto } from './change-plan.dto';
import type { RequestUser } from '../../common/types/authenticated-request';

/**
 * El catálogo de clientes de BusinessBrain.
 *
 * ## Lo que estas rutas SON y lo que no
 *
 * Son la cartera: quiénes son nuestros clientes, qué plan tienen, desde cuándo, y cuánta gente
 * y cuánto material manejan. Información de nuestro propio negocio.
 *
 * **No son una ventana a sus datos.** Lo que hay dentro de una empresa —qué fuentes ha
 * conectado, qué le está fallando, qué dicen sus documentos— vive en
 * `PlatformInspectionController`, detrás de una concesión motivada, acotada y con fecha de
 * fin. Que sean controladores distintos no es organización del código: es que no existe el
 * camino que lleve de aquí a allí.
 *
 * ## Y ninguna de estas rutas mira `platformRole` dentro de una consulta
 *
 * Quien decide es `SuperAdminGuard`, en la puerta. Un servicio que preguntara "¿es
 * administrador?" para devolver más o menos campos sería exactamente el `if` que la separación
 * por rutas existe para no tener.
 */
@UseGuards(SuperAdminGuard)
@Controller('platform/organizations')
export class PlatformOrganizationsController {
  constructor(private readonly organizations: PlatformOrganizationsService) {}

  @Get()
  async list(@Query('page') page?: string) {
    return this.organizations.list(Number(page));
  }

  @Get(':organizationId')
  async detail(@Param('organizationId') organizationId: string) {
    return this.organizations.detail(organizationId);
  }

  /**
   * Cambiar el plan.
   *
   * Exige credencial reciente: es una decisión comercial sobre la cuenta de un cliente, y una
   * sesión de hace tres semanas en un portátil que puede estar en cualquier sitio no es quien
   * debe tomarla.
   */
  @Post(':organizationId/plan')
  @UseGuards(RecentAuthGuard)
  @RequiresRecentAuth(SENSITIVE_ACTIONS.ORGANIZATION_PLAN_CHANGE)
  async changePlan(
    @Param('organizationId') organizationId: string,
    @Body() dto: ChangePlanDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.organizations.changePlan({
      organizationId,
      planTier: dto.planTier,
      actorId: actor.id,
    });
  }
}

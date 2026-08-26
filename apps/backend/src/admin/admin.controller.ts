import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { PlatformAuditService } from './platform-audit.service';
import { ChangePlanDto } from './dto/change-plan.dto';
import type { RequestUser } from '../common/types/authenticated-request';

/** Todas las rutas exigen rol de plataforma SUPERADMIN — ver common/README.md. */
@UseGuards(SuperAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly platformAudit: PlatformAuditService,
  ) {}

  @Get('stats')
  async stats() {
    return this.adminService.stats();
  }

  @Get('organizations')
  async listOrganizations(@Query('page') page?: string) {
    return this.adminService.listOrganizations(Number(page));
  }

  /**
   * Quién es quién. La lectura queda registrada: son datos personales de empleados de
   * empresas clientes, y que mirarlos no cambie nada no quita que haya que poder responder
   * quién los miró.
   */
  @Get('users')
  async listUsers(
    @CurrentUser() actor: RequestUser,
    @Query('page') page?: string,
  ) {
    return this.adminService.listUsers(Number(page), actor.id);
  }

  /**
   * Qué ha hecho la administración de BusinessBrain.
   *
   * **No es la auditoría del sistema**: es la de la plataforma. La actividad de cada empresa
   * no aparece aquí — leerla sería saber de qué habla su negocio sin tocar un solo documento
   * suyo, que es exactamente la vía indirecta que el aislamiento existe para cerrar.
   */
  @Get('audit')
  async audit(
    @Query('page') page?: string,
    @Query('code') code?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.platformAudit.list({
      page: Number(page),
      code,
      organizationId,
    });
  }

  /** Las acciones consultables, para que la interfaz pueda ofrecer el filtro traducido. */
  @Get('audit/actions')
  auditActions() {
    return this.platformAudit.catalog();
  }

  @Post('users/:id/ban')
  async toggleBan(
    @Param('id') userId: string,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.adminService.toggleUserBan(userId, actor.id);
  }

  @Post('organizations/:id/plan')
  async changePlan(
    @Param('id') organizationId: string,
    @Body() dto: ChangePlanDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.adminService.changeOrganizationPlan(
      organizationId,
      dto.planTier,
      actor.id,
    );
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MembershipRole } from '@businessbrain/database';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { OrgRoles } from '../../common/decorators/roles.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  RequestOrganization,
  RequestUser,
} from '../../common/types/authenticated-request';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { AutomationsService } from '../application/automations.service';
import { RunAutomationUseCase } from '../application/run-automation.use-case';
import {
  CreateAutomationDto,
  ListAutomationsQueryDto,
  UpdateAutomationDto,
} from '../dto/automation.dto';

/**
 * Automatizaciones — BUSINESSBRAIN_MIGRATION_PLAN.md §5, §10 (fase 6).
 *
 * Rutas con `:automationId` (no `:id`) por el mismo motivo que el resto de módulos:
 * `OrgRoleGuard` resuelve la organización activa desde `:id`/`:organizationId` o el header
 * `x-org-id`, así que aquí la organización llega siempre por el header.
 *
 * **Leer basta con MEMBER; crear, modificar, retirar y disparar exigen ADMIN.** Crear una
 * automatización concede que algo se ejecute de forma repetida y sin nadie delante: está al
 * nivel de configurar un agente, no al de guardar una preferencia.
 */
@Controller('automations')
@UseGuards(OrgRoleGuard)
export class AutomationsController {
  constructor(
    private readonly automations: AutomationsService,
    private readonly runner: RunAutomationUseCase,
  ) {}

  @Post()
  @OrgRoles(MembershipRole.ADMIN)
  create(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateAutomationDto,
  ) {
    return this.automations.create({
      organizationId: org.id,
      actorUserId: user.id,
      name: dto.name,
      triggerType: dto.triggerType,
      triggerConfig: dto.triggerConfig ?? {},
      actions: dto.actions,
    });
  }

  @Get()
  @OrgRoles(MembershipRole.MEMBER)
  list(
    @CurrentOrg() org: RequestOrganization,
    @Query() query: ListAutomationsQueryDto,
  ) {
    return this.automations.list({
      organizationId: org.id,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get(':automationId')
  @OrgRoles(MembershipRole.MEMBER)
  findOne(
    @CurrentOrg() org: RequestOrganization,
    @Param('automationId') automationId: string,
  ) {
    return this.automations.findOne({
      organizationId: org.id,
      automationId,
    });
  }

  /** Historial de lo que se ejecutó sin nadie delante. Es lo que hace auditable el reloj. */
  @Get(':automationId/runs')
  @OrgRoles(MembershipRole.MEMBER)
  listRuns(
    @CurrentOrg() org: RequestOrganization,
    @Param('automationId') automationId: string,
    @Query() page: PaginationQueryDto,
  ) {
    return this.automations.listRuns({
      organizationId: org.id,
      automationId,
      limit: page.limit,
      offset: page.offset,
    });
  }

  @Patch(':automationId')
  @OrgRoles(MembershipRole.ADMIN)
  update(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('automationId') automationId: string,
    @Body() dto: UpdateAutomationDto,
  ) {
    return this.automations.update({
      organizationId: org.id,
      actorUserId: user.id,
      automationId,
      name: dto.name,
      status: dto.status,
      triggerType: dto.triggerType,
      triggerConfig: dto.triggerConfig,
      actions: dto.actions,
    });
  }

  @Delete(':automationId')
  @OrgRoles(MembershipRole.ADMIN)
  remove(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('automationId') automationId: string,
  ) {
    return this.automations.remove({
      organizationId: org.id,
      actorUserId: user.id,
      automationId,
    });
  }

  /**
   * Disparo manual, sin esperar al calendario.
   *
   * Recorre EXACTAMENTE el mismo camino que el reloj —`RunAutomationUseCase`—, incluida la
   * comprobación de que quien la creó sigue en la organización. Una ruta de prueba que se
   * saltara controles probaría otra cosa distinta de lo que ocurre de madrugada.
   */
  @Post(':automationId/run')
  @OrgRoles(MembershipRole.ADMIN)
  async run(
    @CurrentOrg() org: RequestOrganization,
    @Param('automationId') automationId: string,
  ) {
    const automation = await this.automations.findOne({
      organizationId: org.id,
      automationId,
    });

    return this.runner.execute(automation);
  }
}

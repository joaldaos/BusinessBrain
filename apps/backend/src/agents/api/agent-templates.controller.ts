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
import {
  AgentArea,
  AgentTemplateVisibility,
  MembershipRole,
} from '@businessbrain/database';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { OrgRoles } from '../../common/decorators/roles.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  RequestOrganization,
  RequestUser,
} from '../../common/types/authenticated-request';
import { AgentTemplatesService } from '../application/agent-templates.service';
import { InstallAgentTemplateUseCase } from '../application/install-agent-template.use-case';
import { CreateAgentTemplateDto } from '../dto/create-agent-template.dto';
import { UpdateAgentTemplateDto } from '../dto/update-agent-template.dto';
import { InstallAgentTemplateDto } from '../dto/install-agent-template.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * Catálogo de plantillas de agente — subfase 5.7.
 *
 * Rutas con `:templateId` (no `:id`) por el mismo motivo que en el resto de módulos:
 * `OrgRoleGuard` resuelve la organización activa desde `:id`/`:organizationId` o el header
 * `x-org-id`, así que aquí la organización siempre llega por el header.
 *
 * **Leer el catálogo basta con MEMBER; crear, modificar, retirar e INSTALAR exigen ADMIN.**
 * Instalar está al nivel de crear un agente porque es exactamente eso: deja un `Agent` con
 * capacidades y herramientas ya concedidas.
 *
 * El guard protege el transporte; `AgentTemplatesService` repite la comprobación contra la
 * membresía real, de modo que la autorización viaja con la operación y no con la ruta.
 */
@Controller('agent-templates')
@UseGuards(OrgRoleGuard)
export class AgentTemplatesController {
  constructor(
    private readonly templates: AgentTemplatesService,
    private readonly install: InstallAgentTemplateUseCase,
  ) {}

  @Post()
  @OrgRoles(MembershipRole.ADMIN)
  create(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateAgentTemplateDto,
  ) {
    return this.templates.create({
      organizationId: org.id,
      actorUserId: user.id,
      name: dto.name,
      description: dto.description,
      area: dto.area,
      visibility: dto.visibility,
      defaultSystemPrompt: dto.defaultSystemPrompt,
      defaultCapabilities: dto.defaultCapabilities,
      defaultTools: dto.defaultTools,
    });
  }

  @Get()
  @OrgRoles(MembershipRole.MEMBER)
  list(
    @CurrentOrg() org: RequestOrganization,
    @Query() page: PaginationQueryDto,
    @Query('area') area?: AgentArea,
    @Query('visibility') visibility?: AgentTemplateVisibility,
  ) {
    return this.templates.list({
      organizationId: org.id,
      area,
      visibility,
      limit: page.limit,
      offset: page.offset,
    });
  }

  @Get(':templateId')
  @OrgRoles(MembershipRole.MEMBER)
  findOne(
    @CurrentOrg() org: RequestOrganization,
    @Param('templateId') templateId: string,
  ) {
    return this.templates.findOne({ organizationId: org.id, templateId });
  }

  @Patch(':templateId')
  @OrgRoles(MembershipRole.ADMIN)
  update(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('templateId') templateId: string,
    @Body() dto: UpdateAgentTemplateDto,
  ) {
    return this.templates.update({
      organizationId: org.id,
      actorUserId: user.id,
      templateId,
      name: dto.name,
      description: dto.description,
      area: dto.area,
      visibility: dto.visibility,
      defaultSystemPrompt: dto.defaultSystemPrompt,
      defaultCapabilities: dto.defaultCapabilities,
      defaultTools: dto.defaultTools,
    });
  }

  @Delete(':templateId')
  @OrgRoles(MembershipRole.ADMIN)
  remove(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('templateId') templateId: string,
  ) {
    return this.templates.remove({
      organizationId: org.id,
      actorUserId: user.id,
      templateId,
    });
  }

  /** Instala la plantilla como un `Agent` nuevo. No ejecuta nada: deja el agente configurado. */
  @Post(':templateId/install')
  @OrgRoles(MembershipRole.ADMIN)
  installTemplate(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('templateId') templateId: string,
    @Body() dto: InstallAgentTemplateDto,
  ) {
    return this.install.execute({
      organizationId: org.id,
      actorUserId: user.id,
      templateId,
      name: dto.name,
      systemPrompt: dto.systemPrompt,
      llmProfileId: dto.llmProfileId,
      temperature: dto.temperature,
      knowledgeCollectionIds: dto.knowledgeCollectionIds,
    });
  }
}

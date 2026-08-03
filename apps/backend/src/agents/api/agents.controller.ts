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
import { AgentsService } from '../application/agents.service';
import { CreateAgentDto } from '../dto/create-agent.dto';
import { UpdateAgentDto } from '../dto/update-agent.dto';

/**
 * Rutas con `:agentId` (no `:id`) por el mismo motivo que en el resto de módulos:
 * `OrgRoleGuard` resuelve la organización activa desde `:id`/`:organizationId` o el header
 * `x-org-id`, así que aquí la organización siempre llega por el header.
 *
 * Definir un agente es conceder capacidades y alcance de conocimiento, así que **crear,
 * modificar y desactivar exigen rol ADMIN**; leer basta con MEMBER.
 */
@Controller('agents')
@UseGuards(OrgRoleGuard)
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Post()
  @OrgRoles(MembershipRole.ADMIN)
  create(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateAgentDto,
  ) {
    return this.agents.create({
      organizationId: org.id,
      createdById: user.id,
      name: dto.name,
      area: dto.area,
      systemPrompt: dto.systemPrompt,
      llmProfileId: dto.llmProfileId,
      temperature: dto.temperature,
      capabilities: dto.capabilities,
      tools: dto.tools,
      memoryConfig: dto.memoryConfig,
      guardrails: dto.guardrails,
      knowledgeCollectionIds: dto.knowledgeCollectionIds,
    });
  }

  @Get()
  @OrgRoles(MembershipRole.MEMBER)
  list(
    @CurrentOrg() org: RequestOrganization,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.agents.list({
      organizationId: org.id,
      includeInactive: includeInactive === 'true',
    });
  }

  @Get(':agentId')
  @OrgRoles(MembershipRole.MEMBER)
  findOne(
    @CurrentOrg() org: RequestOrganization,
    @Param('agentId') agentId: string,
  ) {
    return this.agents.findOne({ organizationId: org.id, agentId });
  }

  @Patch(':agentId')
  @OrgRoles(MembershipRole.ADMIN)
  update(
    @CurrentOrg() org: RequestOrganization,
    @Param('agentId') agentId: string,
    @Body() dto: UpdateAgentDto,
  ) {
    return this.agents.update({
      organizationId: org.id,
      agentId,
      name: dto.name,
      area: dto.area,
      systemPrompt: dto.systemPrompt,
      llmProfileId: dto.llmProfileId,
      temperature: dto.temperature,
      capabilities: dto.capabilities,
      tools: dto.tools,
      memoryConfig: dto.memoryConfig,
      guardrails: dto.guardrails,
      knowledgeCollectionIds: dto.knowledgeCollectionIds,
      isActive: dto.isActive,
    });
  }

  /**
   * Baja lógica, no borrado: un agente eliminado de verdad se llevaría por delante la
   * trazabilidad de las conversaciones y recomendaciones que produjo.
   */
  @Delete(':agentId')
  @OrgRoles(MembershipRole.ADMIN)
  deactivate(
    @CurrentOrg() org: RequestOrganization,
    @Param('agentId') agentId: string,
  ) {
    return this.agents.deactivate({ organizationId: org.id, agentId });
  }
}

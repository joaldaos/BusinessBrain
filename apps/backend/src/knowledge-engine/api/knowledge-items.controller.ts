import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import type { RequestOrganization } from '../../common/types/authenticated-request';
import { KnowledgeItemsService } from '../application/knowledge-items.service';

/** Rutas con `:knowledgeItemId` (no `:id`) — misma razón que en KnowledgeSourcesController. */
@Controller('knowledge-items')
@UseGuards(OrgRoleGuard)
export class KnowledgeItemsController {
  constructor(private readonly knowledgeItemsService: KnowledgeItemsService) {}

  @Get()
  async findAll(@CurrentOrg() org: RequestOrganization) {
    return this.knowledgeItemsService.findAll(org.id);
  }

  @Get(':knowledgeItemId')
  async findOne(
    @CurrentOrg() org: RequestOrganization,
    @Param('knowledgeItemId') knowledgeItemId: string,
  ) {
    return this.knowledgeItemsService.findOne(org.id, knowledgeItemId);
  }
}

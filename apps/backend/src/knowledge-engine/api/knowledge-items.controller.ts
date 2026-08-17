import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  RequestOrganization,
  RequestUser,
} from '../../common/types/authenticated-request';
import { KnowledgeItemsService } from '../application/knowledge-items.service';

/**
 * Rutas con `:knowledgeItemId` (no `:id`) — misma razón que en KnowledgeSourcesController.
 *
 * El actor viaja hasta el servicio, y no solo la organización: lo que se puede leer depende de
 * las colecciones concedidas a ESA persona. Ver `KnowledgeItemsService`.
 */
@Controller('knowledge-items')
@UseGuards(OrgRoleGuard)
export class KnowledgeItemsController {
  constructor(private readonly knowledgeItemsService: KnowledgeItemsService) {}

  @Get()
  async findAll(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
  ) {
    return this.knowledgeItemsService.findAll(org.id, user.id);
  }

  @Get(':knowledgeItemId')
  async findOne(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('knowledgeItemId') knowledgeItemId: string,
  ) {
    return this.knowledgeItemsService.findOne(org.id, user.id, knowledgeItemId);
  }
}

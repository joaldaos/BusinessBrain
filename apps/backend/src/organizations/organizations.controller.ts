import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OrgRoleGuard } from '../common/guards/org-role.guard';
import { OrgRoles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentOrg } from '../common/decorators/current-org.decorator';
import { MembershipRole } from '@businessbrain/database';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import type {
  RequestUser,
  RequestOrganization,
} from '../common/types/authenticated-request';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  // Sin OrgRoleGuard: el usuario todavía no pertenece a ninguna organización en este punto.
  @Post()
  async create(
    @Body() dto: CreateOrganizationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.organizationsService.create(dto.name, user.id);
  }

  @UseGuards(OrgRoleGuard)
  @Get(':id')
  async findOne(@CurrentOrg() org: RequestOrganization) {
    return this.organizationsService.findById(org.id);
  }

  @UseGuards(OrgRoleGuard)
  @OrgRoles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateOrganizationDto) {
    return this.organizationsService.update(id, dto);
  }

  @UseGuards(OrgRoleGuard)
  @Get(':id/members')
  async listMembers(@CurrentOrg() org: RequestOrganization) {
    return this.organizationsService.listMembers(org.id);
  }
}

import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { OrgRoleGuard } from '../common/guards/org-role.guard';
import { OrgRoles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentOrg } from '../common/decorators/current-org.decorator';
import { MembershipRole } from '@businessbrain/database';
import { OrganizationsService } from './organizations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import type {
  RequestUser,
  RequestOrganization,
} from '../common/types/authenticated-request';

@Controller()
export class InvitationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @UseGuards(OrgRoleGuard)
  @OrgRoles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @Post('organizations/:id/invitations')
  async create(
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: RequestUser,
    @CurrentOrg() org: RequestOrganization,
  ) {
    return this.organizationsService.createInvitation(org.id, user.id, dto);
  }

  // Sin OrgRoleGuard: quien acepta todavía no es miembro de la organización de la invitación.
  @Post('invitations/:token/accept')
  async accept(
    @Param('token') token: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.organizationsService.acceptInvitation(
      token,
      user.id,
      user.email,
    );
  }
}

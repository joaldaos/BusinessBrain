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
import { ChangePlanDto } from './dto/change-plan.dto';
import type { RequestUser } from '../common/types/authenticated-request';

/** Todas las rutas exigen rol de plataforma SUPERADMIN — ver common/README.md. */
@UseGuards(SuperAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  async stats() {
    return this.adminService.stats();
  }

  @Get('organizations')
  async listOrganizations(@Query('page') page?: string) {
    return this.adminService.listOrganizations(Number(page));
  }

  @Get('users')
  async listUsers(@Query('page') page?: string) {
    return this.adminService.listUsers(Number(page));
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

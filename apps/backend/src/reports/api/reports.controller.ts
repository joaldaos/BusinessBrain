import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
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
import { ReportsService } from '../application/reports.service';
import { CreateReportDto, UpdateReportDto } from '../dto/report.dto';

/**
 * Informes — BUSINESSBRAIN_MIGRATION_PLAN.md §5, §10 (fase 6).
 *
 * Rutas con `:reportId` (no `:id`) por el motivo de siempre: `OrgRoleGuard` resuelve la
 * organización desde `:id`/`:organizationId` o el header, así que aquí llega por el header.
 *
 * **Definir un informe exige ADMIN; generarlo y leerlo basta con MEMBER.** La asimetría es
 * deliberada: definir la plantilla decide qué se mira, y generarlo solo produce lo que quien
 * lo pide ya podría leer por su cuenta — el alcance se resuelve contra SU persona, no contra
 * la de quien lo definió.
 */
@Controller('reports')
@UseGuards(OrgRoleGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @OrgRoles(MembershipRole.ADMIN)
  create(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateReportDto,
  ) {
    return this.reports.create({
      organizationId: org.id,
      actorUserId: user.id,
      name: dto.name,
      format: dto.format,
      template: dto.template,
    });
  }

  @Get()
  @OrgRoles(MembershipRole.MEMBER)
  list(
    @CurrentOrg() org: RequestOrganization,
    @Query() page: PaginationQueryDto,
  ) {
    return this.reports.list({
      organizationId: org.id,
      limit: page.limit,
      offset: page.offset,
    });
  }

  @Get(':reportId')
  @OrgRoles(MembershipRole.MEMBER)
  findOne(
    @CurrentOrg() org: RequestOrganization,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.findOne({ organizationId: org.id, reportId });
  }

  /** Qué se generó y cuándo. El fichero no está: la traza de lo que contenía, sí. */
  @Get(':reportId/runs')
  @OrgRoles(MembershipRole.MEMBER)
  listRuns(
    @CurrentOrg() org: RequestOrganization,
    @Param('reportId') reportId: string,
    @Query() page: PaginationQueryDto,
  ) {
    return this.reports.listRuns({
      organizationId: org.id,
      reportId,
      limit: page.limit,
      offset: page.offset,
    });
  }

  @Patch(':reportId')
  @OrgRoles(MembershipRole.ADMIN)
  update(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('reportId') reportId: string,
    @Body() dto: UpdateReportDto,
  ) {
    return this.reports.update({
      organizationId: org.id,
      actorUserId: user.id,
      reportId,
      name: dto.name,
      template: dto.template,
    });
  }

  @Delete(':reportId')
  @OrgRoles(MembershipRole.ADMIN)
  remove(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.remove({
      organizationId: org.id,
      actorUserId: user.id,
      reportId,
    });
  }

  /**
   * Genera el PDF y lo entrega en la respuesta. No se almacena en ninguna parte.
   *
   * Responde bytes en vez de JSON, así que se salta el interceptor de forma de respuesta a
   * propósito: es un fichero, no un recurso. El `runId` viaja en una cabecera para poder
   * enlazar la descarga con su registro sin abrir el PDF.
   *
   * El alcance se resuelve contra QUIEN LO PIDE: dos personas pueden generar el mismo informe
   * y recibir contenidos distintos, exactamente igual que al leer `GET /insights`.
   */
  @Post(':reportId/generate')
  @OrgRoles(MembershipRole.MEMBER)
  async generate(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('reportId') reportId: string,
    @Res() response: Response,
  ): Promise<void> {
    const generated = await this.reports.generate({
      organizationId: org.id,
      actorUserId: user.id,
      reportId,
      trigger: 'MANUAL',
    });

    response
      .status(201)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${generated.fileName}"`,
      )
      .setHeader('X-Report-Run-Id', generated.runId)
      .send(generated.content);
  }
}

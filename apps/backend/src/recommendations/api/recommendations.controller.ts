import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { MembershipRole, RecommendationStatus } from '@businessbrain/database';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { OrgRoles } from '../../common/decorators/roles.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  RequestOrganization,
  RequestUser,
} from '../../common/types/authenticated-request';
import { RecommendationsService } from '../application/recommendations.service';

/**
 * `GET /recommendations`, `POST /recommendations/:id/accept`, `POST /:id/dismiss` — §7.2.
 *
 * Rutas con `:recommendationId` (no `:id`) por el mismo motivo que en el resto de módulos:
 * `OrgRoleGuard` resuelve la organización desde `:id`/`:organizationId` o el header
 * `x-org-id`, así que aquí la organización siempre llega por el header.
 *
 * **No existe `POST /recommendations`.** Una `Recommendation` solo nace escalando un
 * `Insight` (§11, §12). Un endpoint de creación convertiría este módulo en un generador
 * paralelo de propuestas, con contrato distinto y sin trazabilidad hasta la comprensión que
 * las sostiene.
 *
 * Leer, aceptar y descartar bastan con MEMBER: resolver una propuesta es una decisión de
 * negocio de quien trabaja con ella, y el acceso real lo acota el `effectiveCollectionScope`,
 * no el rol. Un VIEWER, en cambio, no resuelve nada — ni siquiera lo que puede leer.
 */
/** Entero no negativo, o `undefined` si lo recibido no lo es. */
function toPositiveInt(raw?: string): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

@Controller('recommendations')
@UseGuards(OrgRoleGuard)
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get()
  @OrgRoles(MembershipRole.VIEWER)
  list(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Query('status') status?: RecommendationStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.recommendations.list({
      organizationId: org.id,
      userId: user.id,
      status,
      // Un valor no numérico se ignora y manda el defecto: la paginación es una comodidad
      // de lectura, no una vía para provocar un error del servidor con `?limit=abc`.
      limit: toPositiveInt(limit),
      offset: toPositiveInt(offset),
    });
  }

  @Get(':recommendationId')
  @OrgRoles(MembershipRole.VIEWER)
  findOne(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('recommendationId') recommendationId: string,
  ) {
    return this.recommendations.findOne({
      organizationId: org.id,
      userId: user.id,
      recommendationId,
    });
  }

  /** Decisión humana. NO ejecuta ninguna acción externa: registra quién y cuándo. */
  @Post(':recommendationId/accept')
  @OrgRoles(MembershipRole.MEMBER)
  accept(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('recommendationId') recommendationId: string,
  ) {
    return this.recommendations.accept({
      organizationId: org.id,
      userId: user.id,
      recommendationId,
    });
  }

  @Post(':recommendationId/dismiss')
  @OrgRoles(MembershipRole.MEMBER)
  dismiss(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('recommendationId') recommendationId: string,
  ) {
    return this.recommendations.dismiss({
      organizationId: org.id,
      userId: user.id,
      recommendationId,
    });
  }
}

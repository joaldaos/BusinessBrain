import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  BusinessObjectiveOrigin,
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
import { BusinessObjectiveService } from '../application/business-objective.service';
import {
  CreateObjectiveVersionDto,
  DeclareBusinessObjectiveDto,
  ListBusinessObjectivesQueryDto,
} from '../dto/understanding.dto';

/**
 * Objetivos de negocio — UNDERSTANDING_ENGINE_DESIGN.md §3.6, §8. Subfase 6.1.
 *
 * Un `BusinessObjective` CONFIRMADO es el ancla obligatoria de todo juicio de valor: sin él,
 * el gate de riesgo/oportunidad no puede clasificar nada como riesgo ni como oportunidad
 * (§8). Hasta 6.1 no existía ninguna forma de declararlo, así que ese gate no podía dispararse
 * jamás en producción. Esta es esa forma.
 *
 * **Declarar y confirmar son decisiones de negocio: ADMIN.** Leerlas basta con MEMBER — saber
 * qué le importa a la empresa no es información restringida dentro de ella.
 *
 * Los objetivos NO se acotan por colección: no derivan de evidencia, la anclan. Por eso son
 * el único recurso del Understanding Engine cuya lectura no pasa por `CollectionAccess`.
 */
@Controller('business-objectives')
@UseGuards(OrgRoleGuard)
export class BusinessObjectivesController {
  constructor(private readonly objectives: BusinessObjectiveService) {}

  /**
   * Declara un objetivo. Nace `CONFIRMED` porque lo respalda una persona desde el origen
   * (§3.6).
   *
   * `origin` lo fija el SERVIDOR y no se acepta del cliente: permitirlo dejaría fabricar la
   * procedencia —un objetivo con apariencia de inferido por el sistema, o una
   * auto-confirmación disfrazada— y la procedencia es justo lo que distingue un ancla válida
   * de una inventada.
   */
  @Post()
  @OrgRoles(MembershipRole.ADMIN)
  declare(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Body() dto: DeclareBusinessObjectiveDto,
  ) {
    return this.objectives.declare({
      organizationId: org.id,
      statement: dto.statement,
      description: dto.description,
      origin: BusinessObjectiveOrigin.MANUAL_DECLARATION,
      actorUserId: user.id,
    });
  }

  @Get()
  @OrgRoles(MembershipRole.MEMBER)
  list(
    @CurrentOrg() org: RequestOrganization,
    @Query() query: ListBusinessObjectivesQueryDto,
  ) {
    return this.objectives.list({
      organizationId: org.id,
      status: query.status,
      includeSuperseded: query.includeSuperseded,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });
  }

  @Get(':objectiveId')
  @OrgRoles(MembershipRole.MEMBER)
  findOne(
    @CurrentOrg() org: RequestOrganization,
    @Param('objectiveId') objectiveId: string,
  ) {
    return this.objectives.findOne({
      organizationId: org.id,
      businessObjectiveId: objectiveId,
    });
  }

  /** Habilita al objetivo para sostener un `RISK`/`OPPORTUNITY`. Siempre acción humana (§12). */
  @Post(':objectiveId/confirm')
  @OrgRoles(MembershipRole.ADMIN)
  confirm(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('objectiveId') objectiveId: string,
  ) {
    return this.objectives.confirm({
      organizationId: org.id,
      businessObjectiveId: objectiveId,
      actorUserId: user.id,
    });
  }

  @Post(':objectiveId/discard')
  @OrgRoles(MembershipRole.ADMIN)
  discard(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('objectiveId') objectiveId: string,
  ) {
    return this.objectives.discard({
      organizationId: org.id,
      businessObjectiveId: objectiveId,
      actorUserId: user.id,
    });
  }

  /**
   * Nueva versión. Un objetivo NO se edita en sitio (§3.6): se versiona, para preservar el
   * historial de qué le importaba a la empresa en cada momento. Una edición manual conserva
   * la confirmación; solo cambió la redacción, no quién la respalda.
   */
  @Post(':objectiveId/versions')
  @OrgRoles(MembershipRole.ADMIN)
  createVersion(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('objectiveId') objectiveId: string,
    @Body() dto: CreateObjectiveVersionDto,
  ) {
    return this.objectives.createNewVersion({
      organizationId: org.id,
      businessObjectiveId: objectiveId,
      statement: dto.statement,
      description: dto.description,
      origin: BusinessObjectiveOrigin.MANUAL_DECLARATION,
      actorUserId: user.id,
    });
  }
}

import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InsightFeedbackType, MembershipRole } from '@businessbrain/database';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { OrgRoles } from '../../common/decorators/roles.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  RequestOrganization,
  RequestUser,
} from '../../common/types/authenticated-request';
import { CollectionAccessService } from '../../knowledge-engine/application/collection-access.service';
import { RetrieveInsightsUseCase } from '../application/retrieve-insights.use-case';
import { CurateInsightUseCase } from '../application/curate-insight.use-case';
import { InsightScopeService } from '../application/insight-scope.service';
import {
  CurateInsightDto,
  EscalateInsightDto,
  ListInsightsQueryDto,
  RevokeCurationDto,
} from '../dto/understanding.dto';

/**
 * Comprensión derivada — UNDERSTANDING_ENGINE_DESIGN.md §12. Subfase 6.1.
 *
 * `RetrieveInsights` sigue siendo el ÚNICO punto de lectura de comprensión del sistema. Este
 * controlador no razona ni proyecta nada por su cuenta: resuelve quién pregunta, obtiene sus
 * colecciones concedidas y se lo pasa. Si construyera su propia consulta sobre `Insight`
 * habría dos caminos a la comprensión con reglas distintas, que es exactamente lo que la
 * regla de cobertura completa existe para impedir.
 *
 * **El alcance nunca viaja en la petición.** Se deriva del usuario autenticado contra
 * `CollectionAccess`. Aceptarlo del cliente permitiría ampliarlo pidiéndolo.
 *
 * **Leer y curar bastan con MEMBER; escalar exige ADMIN.** Quien trabaja con el conocimiento
 * está cualificado para decir si una conclusión es correcta —y la curación ya está acotada
 * por su alcance—, pero convertirla en una propuesta formal con el contrato completo del
 * Principio de Evolución Asistida es una decisión de responsable.
 */
@Controller('insights')
@UseGuards(OrgRoleGuard)
export class InsightsController {
  constructor(
    private readonly retrieveInsights: RetrieveInsightsUseCase,
    private readonly curateInsight: CurateInsightUseCase,
    private readonly insightScope: InsightScopeService,
    private readonly collectionAccess: CollectionAccessService,
  ) {}

  @Get()
  @OrgRoles(MembershipRole.MEMBER)
  async list(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Query() query: ListInsightsQueryDto,
  ) {
    const allowedCollectionIds = await this.scopeOf(org.id, user.id);

    const insights = await this.retrieveInsights.execute({
      organizationId: org.id,
      allowedCollectionIds,
      types: query.type ? [query.type] : undefined,
      minimumConfidence: query.minimumConfidence,
      businessObjectiveId: query.businessObjectiveId,
      limit: query.limit ?? 50,
    });

    // La paginación se aplica sobre lo YA autorizado: desplazar antes del filtro de alcance
    // dejaría huecos en las páginas de quien no cubre todo.
    return insights.slice(query.offset ?? 0);
  }

  /**
   * Un `Insight` concreto.
   *
   * Recorre el MISMO camino que la lista —decaimiento, frescura y curación incluidos— para
   * que la misma conclusión no se lea distinta según cómo se pida. El 404 y el 403 se
   * distinguen a propósito: fuera de la organización no debe poder saberse que existe;
   * dentro, la persona sí tiene derecho a saber que hay algo que no puede ver y por qué.
   */
  @Get(':insightId')
  @OrgRoles(MembershipRole.MEMBER)
  async findOne(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('insightId') insightId: string,
  ) {
    const allowedCollectionIds = await this.scopeOf(org.id, user.id);

    const [found] = await this.retrieveInsights.execute({
      organizationId: org.id,
      allowedCollectionIds,
      insightIds: [insightId],
      limit: 1,
    });
    if (found) return found;

    // No salió: o no existe en esta organización (404) o el alcance no lo cubre (403).
    await this.insightScope.assertActorCoversInsightById({
      organizationId: org.id,
      actorUserId: user.id,
      insightId,
    });

    // Existe y el alcance lo cubre: quedó fuera por un filtro de LECTURA —estado terminal—,
    // no por autorización. No se expone: `historicalMode` está deliberadamente fuera de la API.
    throw new NotFoundException('Insight no disponible');
  }

  /**
   * Curación humana (§3.7). Tiene PRIORIDAD sobre cualquier recálculo automático posterior,
   * así que exige cubrir el alcance del `Insight`: es una escritura duradera, no una opinión.
   */
  @Post(':insightId/curate')
  @OrgRoles(MembershipRole.MEMBER)
  async curate(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('insightId') insightId: string,
    @Body() dto: CurateInsightDto,
  ) {
    await this.curateInsight.curate({
      organizationId: org.id,
      insightId,
      type: dto.type,
      comment: dto.comment,
      actorUserId: user.id,
    });

    return { insightId, type: dto.type };
  }

  /**
   * Escalar a `Recommendation` (§11, §12). **No ejecuta absolutamente nada**: registra una
   * propuesta en estado `NEW` para revisión humana.
   */
  @Post(':insightId/escalate')
  @OrgRoles(MembershipRole.ADMIN)
  escalate(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('insightId') insightId: string,
    @Body() dto: EscalateInsightDto,
  ) {
    return this.curateInsight.escalateToRecommendation({
      organizationId: org.id,
      insightId,
      actorUserId: user.id,
      contract: {
        title: dto.title,
        detected: dto.detected,
        justification: dto.justification,
        estimatedImpact: dto.estimatedImpact,
        advantages: dto.advantages,
        drawbacks: dto.drawbacks,
        affectedAreas: dto.affectedAreas,
        migrationPlan: dto.migrationPlan,
      },
      priority: dto.priority,
    });
  }

  private async scopeOf(
    organizationId: string,
    userId: string,
  ): Promise<string[]> {
    return this.collectionAccess.accessibleCollectionIds({
      organizationId,
      userId,
    });
  }
}

/**
 * Revocación de una curación — ruta aparte porque el recurso es la ENTRADA de feedback, no el
 * `Insight`: revocar exige decir qué entrada concreta se deja sin efecto (§3.7), y colgarlo
 * de `/insights/:id` sugeriría que se revoca "la curación del insight", que no existe: puede
 * haber varias.
 */
@Controller('insight-feedback')
@UseGuards(OrgRoleGuard)
export class InsightFeedbackController {
  constructor(private readonly curateInsight: CurateInsightUseCase) {}

  @Post(':feedbackId/revoke')
  @OrgRoles(MembershipRole.MEMBER)
  async revoke(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('feedbackId') feedbackId: string,
    @Body() dto: RevokeCurationDto,
  ) {
    await this.curateInsight.revokeCuration({
      organizationId: org.id,
      feedbackId,
      actorUserId: user.id,
      comment: dto.comment,
    });

    return { feedbackId, type: InsightFeedbackType.REVOCATION };
  }
}

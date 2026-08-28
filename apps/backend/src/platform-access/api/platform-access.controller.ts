import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PlatformAccessScope } from '@businessbrain/database';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { RecentAuthGuard } from '../../common/guards/recent-auth.guard';
import { RequiresRecentAuth } from '../../common/decorators/requires-recent-auth.decorator';
import { SENSITIVE_ACTIONS } from '../../common/security/sensitive-actions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/authenticated-request';
import { PlatformAccessService } from '../application/platform-access.service';
import { OrganizationInspectionService } from '../application/organization-inspection.service';
import { RequestAccessDto } from './request-access.dto';

/**
 * Lo que la administración de BusinessBrain puede consultar de UNA empresa, y con qué permiso.
 *
 * ## Ninguna de estas rutas devuelve nada por el hecho de ser administrador
 *
 * Todas empiezan pidiéndole permiso a `PlatformAccessService`. Sin una concesión vigente, del
 * alcance correcto y a nombre de quien pregunta, la respuesta es la misma que le daríamos a un
 * desconocido. El rol de plataforma abre la puerta de la operación, no la de los negocios
 * ajenos.
 *
 * ## Y cada alcance tiene su propia ruta
 *
 * No hay una ruta que devuelva más o menos según el permiso. La de metadatos **no puede**
 * devolver el texto de un documento: la consulta que la sirve no lo selecciona. Un único
 * endpoint con condicionales habría sido más corto y habría dejado la garantía a merced de un
 * `if` bien puesto.
 *
 * ## Pedir acceso exige reautenticarse; usarlo, no
 *
 * La decisión de abrir una puerta a los datos de un cliente se toma una vez y hay que
 * demostrar quién la toma. Lo que viene después —abrir el panorama, leer un documento dentro
 * de una concesión ya vigente— no vuelve a preguntar: convertir una investigación en un
 * teclado de códigos empujaría a pedir concesiones más largas para no tener que repetir, que
 * es exactamente el resultado contrario al que se busca.
 */
@UseGuards(SuperAdminGuard)
@Controller('platform/organizations/:organizationId')
export class PlatformAccessController {
  constructor(
    private readonly access: PlatformAccessService,
    private readonly inspection: OrganizationInspectionService,
  ) {}

  /** Pedir acceso. Metadatos y diagnóstico nacen utilizables; el contenido, pendiente. */
  @Post('access')
  @UseGuards(RecentAuthGuard)
  @RequiresRecentAuth(SENSITIVE_ACTIONS.PLATFORM_ACCESS_REQUEST)
  async request(
    @Param('organizationId') organizationId: string,
    @CurrentUser() admin: RequestUser,
    @Body() dto: RequestAccessDto,
  ) {
    return this.access.request({
      organizationId,
      requestedById: admin.id,
      scope: dto.scope,
      reason: dto.reason,
      hours: dto.hours,
    });
  }

  /** Los accesos a esta empresa: los vigentes, los caducados y los retirados. */
  @Get('access')
  async list(@Param('organizationId') organizationId: string) {
    return this.access.listForOrganization(organizationId);
  }

  /** Retirar un acceso propio antes de que caduque. */
  @Post('access/:grantId/revoke')
  @UseGuards(RecentAuthGuard)
  @RequiresRecentAuth(SENSITIVE_ACTIONS.PLATFORM_ACCESS_REVOKE)
  async revoke(
    @Param('grantId') grantId: string,
    @CurrentUser() admin: RequestUser,
  ) {
    return this.access.revoke({ grantId, actorId: admin.id });
  }

  // ── Lo que se puede consultar, alcance por alcance ─────────────────────────

  @Get('overview')
  async overview(
    @Param('organizationId') organizationId: string,
    @CurrentUser() admin: RequestUser,
  ) {
    await this.access.assertUsable({
      organizationId,
      adminId: admin.id,
      scope: PlatformAccessScope.METADATA,
      what: 'overview',
    });

    return this.inspection.overview(organizationId);
  }

  @Get('diagnostics')
  async diagnostics(
    @Param('organizationId') organizationId: string,
    @CurrentUser() admin: RequestUser,
  ) {
    await this.access.assertUsable({
      organizationId,
      adminId: admin.id,
      scope: PlatformAccessScope.DIAGNOSTICS,
      what: 'diagnostics',
    });

    return this.inspection.diagnostics(organizationId);
  }

  @Get('documents')
  async documents(
    @Param('organizationId') organizationId: string,
    @CurrentUser() admin: RequestUser,
  ) {
    await this.access.assertUsable({
      organizationId,
      adminId: admin.id,
      scope: PlatformAccessScope.CONTENT,
      what: 'documents.list',
    });

    return this.inspection.documents(organizationId);
  }

  /**
   * El texto de un documento concreto.
   *
   * Se pide de uno en uno para que la traza registre exactamente cuál se leyó. Un endpoint que
   * devolviera todos con su texto dejaría una sola entrada diciendo "se abrió la lista", y el
   * cliente no podría saber qué se leyó de verdad.
   */
  @Get('documents/:knowledgeItemId')
  async document(
    @Param('organizationId') organizationId: string,
    @Param('knowledgeItemId') knowledgeItemId: string,
    @CurrentUser() admin: RequestUser,
  ) {
    await this.access.assertUsable({
      organizationId,
      adminId: admin.id,
      scope: PlatformAccessScope.CONTENT,
      what: `document:${knowledgeItemId}`,
    });

    return this.inspection.document(organizationId, knowledgeItemId);
  }
}

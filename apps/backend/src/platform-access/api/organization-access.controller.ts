import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { MembershipRole } from '@businessbrain/database';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { RecentAuthGuard } from '../../common/guards/recent-auth.guard';
import { OrgRoles } from '../../common/decorators/roles.decorator';
import { RequiresRecentAuth } from '../../common/decorators/requires-recent-auth.decorator';
import { SENSITIVE_ACTIONS } from '../../common/security/sensitive-actions';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  RequestOrganization,
  RequestUser,
} from '../../common/types/authenticated-request';
import { PlatformAccessService } from '../application/platform-access.service';
import { ApproveAccessDto } from './request-access.dto';

/**
 * El lado del CLIENTE: qué accesos ha tenido BusinessBrain a sus datos, y cuáles aprueba.
 *
 * ## Por qué esto existe
 *
 * Un acceso administrativo que el cliente no puede ver no es un acceso auditado: es un acceso
 * registrado en un sitio al que él no llega. Aquí puede responder por su cuenta a quién
 * accedió, cuándo, por qué y con qué alcance — sin pedírnoslo y sin que se lo contemos nosotros.
 *
 * ## Y por qué solo el propietario
 *
 * Aprobar que alguien de fuera lea los documentos de la empresa no es una tarea de
 * administración diaria. Es de quien responde por la empresa, igual que exportar o borrar sus
 * datos.
 */
@UseGuards(OrgRoleGuard, RecentAuthGuard)
@OrgRoles(MembershipRole.OWNER)
@Controller('organizations/:organizationId/platform-access')
export class OrganizationAccessController {
  constructor(private readonly access: PlatformAccessService) {}

  /**
   * El historial completo: peticiones pendientes, accesos vigentes, caducados y retirados.
   *
   * No se pagina ni se filtra: son pocos, y esconder los antiguos detrás de una página haría
   * que nadie los mirara nunca.
   */
  @Get()
  async list(@CurrentOrg() org: RequestOrganization) {
    return this.access.listForOrganization(org.id);
  }

  /**
   * Aprobar que la administración lea el contenido de esta empresa.
   *
   * Exige haber demostrado la identidad hace poco. Es la decisión que abre los documentos de
   * la empresa a alguien de fuera: una sesión de hace tres semanas, en un portátil que puede
   * estar en cualquier sitio, no es quien debe tomarla.
   */
  @Post(':grantId/approve')
  @RequiresRecentAuth(SENSITIVE_ACTIONS.PLATFORM_ACCESS_APPROVE)
  async approve(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('grantId') grantId: string,
    @Body() dto: ApproveAccessDto,
  ) {
    return this.access.approve({
      grantId,
      organizationId: org.id,
      ownerUserId: user.id,
      hours: dto.hours,
    });
  }

  /**
   * Retirar un acceso que se aprobó.
   *
   * Una aprobación que no se puede retirar es un permiso permanente hasta la fecha de fin. Si
   * el cliente cambia de opinión a mitad, corta.
   */
  @Post(':grantId/revoke')
  @RequiresRecentAuth(SENSITIVE_ACTIONS.PLATFORM_ACCESS_REVOKE)
  async revoke(
    @CurrentUser() user: RequestUser,
    @Param('grantId') grantId: string,
  ) {
    return this.access.revoke({ grantId, actorId: user.id });
  }
}

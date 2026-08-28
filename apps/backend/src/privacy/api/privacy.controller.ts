import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MembershipRole } from '@businessbrain/database';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { RecentAuthGuard } from '../../common/guards/recent-auth.guard';
import { OrgRoles } from '../../common/decorators/roles.decorator';
import { RequiresRecentAuth } from '../../common/decorators/requires-recent-auth.decorator';
import { SENSITIVE_ACTIONS } from '../../common/security/sensitive-actions';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationExportService } from '../application/organization-export.service';
import { OrganizationErasureService } from '../application/organization-erasure.service';
import { EraseOrganizationDataDto } from './erase-organization-data.dto';
import {
  AI_PROVIDER_DATA_FLOWS,
  PENDING_LEGAL,
  STORED_DATA,
} from '../domain/data-flow';
import type {
  RequestOrganization,
  RequestUser,
} from '../../common/types/authenticated-request';

/**
 * Privacidad: qué sabemos de la empresa, cómo se lo lleva y cómo lo borra.
 *
 * Las tres rutas viven juntas porque son la misma conversación con el cliente. Repartidas
 * —el aviso en configuración, la exportación en la organización, el borrado en administración—
 * cada una parecería un detalle menor, y juntas son lo que permite responder a un cliente que
 * pregunta qué pasa con sus contratos.
 */
@Controller()
export class PrivacyController {
  constructor(
    private readonly exportService: OrganizationExportService,
    private readonly erasureService: OrganizationErasureService,
  ) {}

  /**
   * Qué sale hacia el proveedor de IA y qué se guarda aquí.
   *
   * Se sirve desde el backend en lugar de escribirlo en la interfaz porque la lista está
   * anclada al código: una prueba estructural comprueba que no hay ninguna llamada al
   * proveedor sin declarar. Un aviso escrito a mano en una pantalla se queda desactualizado
   * en cuanto alguien añade una función, y un aviso desactualizado afirma algo falso.
   *
   * No lleva guard de organización: es información sobre el producto, igual para todos, y
   * cualquiera que haya iniciado sesión debe poder leerla.
   */
  @Get('privacy/notice')
  notice() {
    return {
      aiProvider: AI_PROVIDER_DATA_FLOWS,
      stored: STORED_DATA,
      pending: PENDING_LEGAL,
    };
  }

  /**
   * Una copia de todo lo de la empresa.
   *
   * Solo el PROPIETARIO. No es leer conocimiento —eso va acotado por colección— sino un acto
   * administrativo sobre los datos de la empresa entera. Ver el servicio.
   */
  @UseGuards(OrgRoleGuard, RecentAuthGuard)
  @OrgRoles(MembershipRole.OWNER)
  @RequiresRecentAuth(SENSITIVE_ACTIONS.ORGANIZATION_EXPORT)
  @Get('organizations/:id/export')
  async exportData(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
  ) {
    return this.exportService.export(org.id, user.id);
  }

  /**
   * Borrar los datos de la empresa. Irreversible.
   *
   * `POST` y no `DELETE` a propósito: hace falta un cuerpo con el nombre tecleado, y un
   * `DELETE` con cuerpo obligatorio es un contrato que algunos clientes y proxies tratan mal.
   * Aquí lo que importa es que la confirmación llegue siempre, no la elegancia del verbo.
   */
  @UseGuards(OrgRoleGuard, RecentAuthGuard)
  @OrgRoles(MembershipRole.OWNER)
  @RequiresRecentAuth(SENSITIVE_ACTIONS.ORGANIZATION_ERASE)
  @HttpCode(HttpStatus.OK)
  @Post('organizations/:id/erase')
  async erase(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Body() dto: EraseOrganizationDataDto,
  ) {
    return this.erasureService.erase({
      organizationId: org.id,
      actorId: user.id,
      confirmationName: dto.confirmationName,
    });
  }
}

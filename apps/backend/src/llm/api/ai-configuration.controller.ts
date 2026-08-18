import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { MembershipRole } from '@businessbrain/database';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { OrgRoles } from '../../common/decorators/roles.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  RequestOrganization,
  RequestUser,
} from '../../common/types/authenticated-request';
import { AiConfigurationService } from '../application/ai-configuration.service';
import { ConfigureAiDto } from '../dto/configure-ai.dto';

/**
 * Configuración de la IA de la organización.
 *
 * **Leer el estado es de cualquier miembro; cambiarlo exige ADMIN.** Saber si BusinessBrain
 * está listo lo necesita todo el mundo —explica por qué una pregunta no encuentra nada— pero
 * poner una clave compromete gasto real en la cuenta del cliente, y eso está al nivel de
 * conectar el Drive de la empresa, no de guardar una preferencia.
 *
 * Ninguna respuesta de este controlador contiene la clave. Ver `AiConfigurationService`.
 */
@Controller('ai-configuration')
@UseGuards(OrgRoleGuard)
export class AiConfigurationController {
  constructor(private readonly aiConfiguration: AiConfigurationService) {}

  @Get()
  @OrgRoles(MembershipRole.VIEWER)
  status(@CurrentOrg() org: RequestOrganization) {
    return this.aiConfiguration.status(org.id);
  }

  /** Proveedores elegibles, con dónde consigue cada uno su clave. */
  @Get('providers')
  @OrgRoles(MembershipRole.VIEWER)
  providers() {
    return this.aiConfiguration.catalog();
  }

  @Post()
  @OrgRoles(MembershipRole.ADMIN)
  configure(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Body() dto: ConfigureAiDto,
  ) {
    return this.aiConfiguration.configure({
      organizationId: org.id,
      actorUserId: user.id,
      provider: dto.provider,
      apiKey: dto.apiKey,
      modelName: dto.modelName,
    });
  }

  @Delete()
  @OrgRoles(MembershipRole.ADMIN)
  removeOwnKey(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
  ) {
    return this.aiConfiguration.removeOwnKey({
      organizationId: org.id,
      actorUserId: user.id,
    });
  }
}

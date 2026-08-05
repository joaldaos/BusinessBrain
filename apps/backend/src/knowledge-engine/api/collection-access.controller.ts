import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MembershipRole } from '@businessbrain/database';
import { IsString, MinLength } from 'class-validator';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { OrgRoles } from '../../common/decorators/roles.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  RequestOrganization,
  RequestUser,
} from '../../common/types/authenticated-request';
import { CollectionAccessService } from '../application/collection-access.service';

export class GrantCollectionAccessDto {
  @IsString()
  @MinLength(1)
  userId!: string;
}

/**
 * Concesión de acceso a colecciones de conocimiento — subfase 5.8.
 *
 * Solo ADMIN: conceder una colección amplía lo que una persona puede ver del Knowledge
 * Engine y, a través del `effectiveCollectionScope`, qué comprensión y qué recomendaciones
 * le resultan accesibles. Es la misma clase de operación privilegiada que definir un agente.
 *
 * No hay endpoint para consultar el acceso de OTRA persona más allá del listado por
 * colección, que ya es ADMIN: quién ve qué es información de gobierno, no de consumo.
 */
@Controller('knowledge-collections/:collectionId/access')
@UseGuards(OrgRoleGuard)
export class CollectionAccessController {
  constructor(private readonly access: CollectionAccessService) {}

  @Get()
  @OrgRoles(MembershipRole.ADMIN)
  list(
    @CurrentOrg() org: RequestOrganization,
    @Param('collectionId') collectionId: string,
  ) {
    return this.access.listForCollection({
      organizationId: org.id,
      knowledgeCollectionId: collectionId,
    });
  }

  @Post()
  @OrgRoles(MembershipRole.ADMIN)
  grant(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() actor: RequestUser,
    @Param('collectionId') collectionId: string,
    @Body() dto: GrantCollectionAccessDto,
  ) {
    return this.access.grant({
      organizationId: org.id,
      knowledgeCollectionId: collectionId,
      userId: dto.userId,
      grantedById: actor.id,
    });
  }

  @Delete(':userId')
  @OrgRoles(MembershipRole.ADMIN)
  revoke(
    @CurrentOrg() org: RequestOrganization,
    @Param('collectionId') collectionId: string,
    @Param('userId') userId: string,
  ) {
    return this.access.revoke({
      organizationId: org.id,
      knowledgeCollectionId: collectionId,
      userId,
    });
  }
}

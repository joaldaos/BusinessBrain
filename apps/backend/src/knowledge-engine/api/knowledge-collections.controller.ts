import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { MembershipRole } from '@businessbrain/database';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { OrgRoles } from '../../common/decorators/roles.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  RequestOrganization,
  RequestUser,
} from '../../common/types/authenticated-request';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';

export class CreateKnowledgeCollectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}

/**
 * Colecciones de conocimiento — `BUSINESSBRAIN_MIGRATION_PLAN.md` §5.
 *
 * El plan las declara desde el principio (`GET/POST /knowledge-collections`) y nunca se
 * habían expuesto: solo existía la ruta de conceder acceso a una, así que una colección solo
 * podía crearse escribiendo en la base de datos a mano.
 *
 * La consecuencia era grave y silenciosa: **una colección es la unidad de alcance de todo el
 * sistema**. Sin poder crear ninguna, todo lo ingerido quedaba fuera de cualquier colección,
 * su alcance efectivo era vacío y la regla fail-closed lo ocultaba a todo el mundo — incluida
 * la comprensión derivada. El motor entero funcionaba y no había forma de ver su resultado.
 *
 * **Crear una colección exige ADMIN; listarlas basta con MEMBER.** Crear define una frontera
 * de acceso, y eso está al nivel de conceder permisos, no de guardar una preferencia.
 */
@Controller('knowledge-collections')
@UseGuards(OrgRoleGuard)
export class KnowledgeCollectionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @OrgRoles(MembershipRole.MEMBER)
  list(@CurrentOrg() org: RequestOrganization) {
    // Se listan TODAS las de la organización, no solo las concedidas: hay que poder ver qué
    // existe para poder pedir acceso. Lo que la pertenencia protege es el CONTENIDO, y eso lo
    // sigue filtrando el alcance en cada punto de lectura.
    return this.prisma.knowledgeCollection.findMany({
      where: { organizationId: org.id },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        _count: { select: { knowledgeItemCollections: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post()
  @OrgRoles(MembershipRole.ADMIN)
  async create(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateKnowledgeCollectionDto,
  ) {
    const collection = await this.prisma.knowledgeCollection.create({
      data: {
        organizationId: org.id,
        name: dto.name,
        description: dto.description ?? null,
      },
      select: { id: true, name: true, description: true, createdAt: true },
    });

    await this.audit.record({
      organizationId: org.id,
      actorId: user.id,
      action: AUDIT_ACTIONS.KNOWLEDGE_COLLECTION_CREATED,
      targetType: AUDIT_TARGET_TYPES.KNOWLEDGE_COLLECTION,
      targetId: collection.id,
      metadata: { name: dto.name },
    });

    return collection;
  }
}

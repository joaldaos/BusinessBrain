import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/utils/encryption.util';
import type { CreateKnowledgeSourceDto } from '../dto/create-knowledge-source.dto';

/** Nunca se selecciona `configEnc` en una respuesta — es un secreto cifrado, no un dato a exponer. */
const PUBLIC_SELECT = {
  id: true,
  organizationId: true,
  type: true,
  connectorKey: true,
  name: true,
  status: true,
  lastSyncedAt: true,
  lastError: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * CRUD de `KnowledgeSource` (KNOWLEDGE_ENGINE_DESIGN.md §3.2). Sin reglas de negocio no
 * triviales más allá de cifrar `configEnc` — por eso vive como servicio plano y no como
 * caso de uso; la orquestación real de ingesta está en `IngestFromSourceUseCase`.
 */
@Injectable()
export class KnowledgeSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async create(
    organizationId: string,
    createdById: string,
    dto: CreateKnowledgeSourceDto,
  ) {
    const collectionIds = [...new Set(dto.knowledgeCollectionIds ?? [])];
    await this.assertCollectionsBelongToOrg(organizationId, collectionIds);

    // En una transacción: una fuente creada sin sus colecciones sería una fuente cuyo
    // contenido nace invisible, y nada lo delataría hasta que alguien echara de menos sus
    // conclusiones.
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.knowledgeSource.create({
        data: {
          organizationId,
          type: dto.type,
          connectorKey: dto.connectorKey,
          name: dto.name,
          configEnc: this.encryption.encrypt(JSON.stringify(dto.config ?? {})),
          createdById,
        },
        select: PUBLIC_SELECT,
      });

      if (collectionIds.length > 0) {
        await tx.knowledgeSourceCollection.createMany({
          data: collectionIds.map((knowledgeCollectionId) => ({
            knowledgeSourceId: source.id,
            knowledgeCollectionId,
            organizationId,
          })),
        });
      }

      return source;
    });
  }

  /**
   * Las colecciones declaradas deben ser de ESTA organización.
   *
   * La clave foránea compuesta ya lo hace imposible a nivel de base de datos; aquí se traduce
   * ese fallo de integridad a un error explicable en vez de dejar escapar una violación de
   * restricción sin contexto — mismo criterio que `CollectionAccessService.grant`.
   */
  private async assertCollectionsBelongToOrg(
    organizationId: string,
    collectionIds: string[],
  ): Promise<void> {
    if (collectionIds.length === 0) return;

    const found = await this.prisma.knowledgeCollection.count({
      where: { id: { in: collectionIds }, organizationId },
    });
    if (found !== collectionIds.length) {
      throw new BadRequestException(
        'Alguna de las colecciones indicadas no existe o pertenece a otra organización',
      );
    }
  }

  async findAll(organizationId: string) {
    return this.prisma.knowledgeSource.findMany({
      where: { organizationId },
      select: PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(organizationId: string, knowledgeSourceId: string) {
    const source = await this.prisma.knowledgeSource.findFirst({
      where: { id: knowledgeSourceId, organizationId },
      select: PUBLIC_SELECT,
    });
    if (!source) {
      throw new NotFoundException('KnowledgeSource no encontrada');
    }
    return source;
  }
}

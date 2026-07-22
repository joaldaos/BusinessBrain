import { Injectable, NotFoundException } from '@nestjs/common';
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
    return this.prisma.knowledgeSource.create({
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

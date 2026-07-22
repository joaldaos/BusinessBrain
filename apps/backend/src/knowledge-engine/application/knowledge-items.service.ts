import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Lectura de `KnowledgeItem`. En esta subfase (2.1) no hay escritura de dominio propia aquí:
 * los ítems se crean exclusivamente a través de `IngestFromSourceUseCase`.
 */
@Injectable()
export class KnowledgeItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(organizationId: string) {
    return this.prisma.knowledgeItem.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Incluye procedencia (fuente + job de ingesta que lo originó) para cumplir el criterio de
   * validación de la subfase 2.1: "producir un KnowledgeItem normalizado, trazable a su job"
   * (KNOWLEDGE_ENGINE_DESIGN.md §19, subfase 2.1). Desde la subfase 2.2 incluye también el grafo
   * de linaje (§3.7, §6): qué ítem reemplazó a este (si aplica) y a qué ítem reemplazó este, para
   * que la trazabilidad de versiones sea consultable sin acceso directo a la base de datos.
   */
  async findOne(organizationId: string, knowledgeItemId: string) {
    const item = await this.prisma.knowledgeItem.findFirst({
      where: { id: knowledgeItemId, organizationId },
      include: {
        originKnowledgeSource: {
          select: { id: true, name: true, type: true, connectorKey: true },
        },
        originIngestionJob: {
          select: {
            id: true,
            status: true,
            stats: true,
            triggerType: true,
            startedAt: true,
            finishedAt: true,
          },
        },
        lineageEdgesAsFrom: {
          select: {
            id: true,
            type: true,
            toKnowledgeItemId: true,
            createdAt: true,
          },
        },
        lineageEdgesAsTo: {
          select: {
            id: true,
            type: true,
            fromKnowledgeItemId: true,
            createdAt: true,
          },
        },
      },
    });
    if (!item) {
      throw new NotFoundException('KnowledgeItem no encontrado');
    }
    return item;
  }
}

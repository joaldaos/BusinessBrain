import { Injectable } from '@nestjs/common';
import { Prisma } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  MemoryEntry,
  MemoryScope,
  MemoryStorePort,
} from '../domain/ports/memory-store.port';

/**
 * Implementación del almacén de memoria sobre Prisma.
 *
 * Toda consulta filtra por los TRES campos del alcance —organización, agente y usuario—
 * aunque la clave única sea `(agentId, userId, key)`. El `organizationId` es redundante para
 * localizar la fila y deliberadamente no se omite: si alguna vez se desincronizara del
 * agente, esta condición hace que la consulta no devuelva nada en lugar de devolver algo de
 * otro tenant.
 */
@Injectable()
export class PrismaMemoryStoreAdapter implements MemoryStorePort {
  constructor(private readonly prisma: PrismaService) {}

  async recall(scope: MemoryScope, limit: number): Promise<MemoryEntry[]> {
    const rows = await this.prisma.agentMemory.findMany({
      where: {
        organizationId: scope.organizationId,
        agentId: scope.agentId,
        userId: scope.userId,
      },
      // Las más recientes primero: si hay que recortar, se conserva lo más actual.
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      key: row.key,
      value: row.value,
      conversationId: row.conversationId,
      updatedAt: row.updatedAt,
    }));
  }

  async remember(
    scope: MemoryScope,
    entry: { key: string; value: unknown; conversationId?: string },
  ): Promise<void> {
    await this.prisma.agentMemory.upsert({
      where: {
        agentId_userId_key: {
          agentId: scope.agentId,
          userId: scope.userId,
          key: entry.key,
        },
      },
      create: {
        organizationId: scope.organizationId,
        agentId: scope.agentId,
        userId: scope.userId,
        conversationId: entry.conversationId ?? null,
        key: entry.key,
        value: entry.value as Prisma.InputJsonValue,
      },
      update: {
        value: entry.value as Prisma.InputJsonValue,
        conversationId: entry.conversationId ?? null,
      },
    });
  }

  async forget(scope: MemoryScope, key: string): Promise<void> {
    // `deleteMany` y no `delete`: así el alcance completo entra en el WHERE. Con `delete`
    // habría que localizar por la clave única, que no incluye la organización.
    await this.prisma.agentMemory.deleteMany({
      where: {
        organizationId: scope.organizationId,
        agentId: scope.agentId,
        userId: scope.userId,
        key,
      },
    });
  }
}

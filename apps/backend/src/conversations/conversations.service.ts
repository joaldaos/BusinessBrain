import { Injectable, NotFoundException } from '@nestjs/common';
import type { Conversation } from '@businessbrain/database';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Gestión de conversaciones — BUSINESSBRAIN_MIGRATION_PLAN.md §6, §7.2.
 *
 * `ConversationsModule` es una **superficie de consumo, no el núcleo**: no contiene lógica
 * de RAG ni de razonamiento propia. Delega la comprensión en `RetrieveInsights` del
 * Understanding Engine y la recuperación de conocimiento en el Retriever del Knowledge
 * Engine — nunca accede a `KnowledgeChunk` ni a `Insight` por su cuenta.
 *
 * Este servicio cubre únicamente el ciclo de vida de la conversación. El pipeline de
 * respuesta vive en `send-message.use-case.ts`.
 */
@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: {
    organizationId: string;
    userId: string;
    title?: string;
    agentId?: string;
  }): Promise<Conversation> {
    return this.prisma.conversation.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId,
        title: params.title ?? null,
        agentId: params.agentId ?? null,
      },
    });
  }

  /**
   * Conversaciones del usuario dentro de la organización activa. El filtro por organización
   * es obligatorio en toda consulta, igual que en el resto del sistema.
   */
  async listForUser(params: {
    organizationId: string;
    userId: string;
    includeArchived?: boolean;
  }) {
    return this.prisma.conversation.findMany({
      where: {
        organizationId: params.organizationId,
        userId: params.userId,
        ...(params.includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { messages: true } } },
    });
  }

  /**
   * Una conversación con su historial. Pertenece a un usuario dentro de una organización:
   * ninguna de las dos condiciones es opcional.
   */
  async findOne(params: {
    organizationId: string;
    userId: string;
    conversationId: string;
  }) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: params.conversationId,
        organizationId: params.organizationId,
        userId: params.userId,
      },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation)
      throw new NotFoundException('Conversación no encontrada');

    return conversation;
  }

  async rename(params: {
    organizationId: string;
    userId: string;
    conversationId: string;
    title: string;
  }): Promise<Conversation> {
    await this.findOne(params);

    return this.prisma.conversation.update({
      where: { id: params.conversationId },
      data: { title: params.title },
    });
  }

  /**
   * Archivar es una baja lógica: la conversación deja de listarse pero conserva su
   * historial, coherente con el principio de nunca destruir información del sistema.
   */
  async archive(params: {
    organizationId: string;
    userId: string;
    conversationId: string;
  }): Promise<Conversation> {
    await this.findOne(params);

    return this.prisma.conversation.update({
      where: { id: params.conversationId },
      data: { archivedAt: new Date() },
    });
  }
}

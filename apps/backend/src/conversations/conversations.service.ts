import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
    await this.assertAgentBelongsToOrg(params.organizationId, params.agentId);

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
   * `agentId` llega en el cuerpo de la petición y hasta aquí se persistía tal cual.
   *
   * Hoy `RunAgentUseCase` vuelve a resolver el agente contra la organización, así que un
   * `agentId` ajeno acaba fallando al enviar el primer mensaje: el sistema falla cerrado. Se
   * valida igualmente en la creación por tres motivos, en orden de importancia:
   *
   * 1. **La validación no debe depender de que otro la repita.** Que hoy exista un segundo
   *    control es una propiedad del código actual, no una garantía del modelo. El día que
   *    aparezca otro consumidor de `Conversation.agentId` heredaría una referencia que nadie
   *    comprobó nunca.
   * 2. **Deja estado imposible persistido.** Una conversación apuntando a un agente de otro
   *    tenant es una fila que no debería poder existir, y que además queda inservible: cada
   *    mensaje enviado devolvería 404 sin explicar por qué.
   * 3. **Es la misma invariante que `AgentsService` ya aplica** a `knowledgeCollectionIds`,
   *    `llmProfileId` y `templateId`. Dejar `agentId` fuera era una asimetría, no una
   *    decisión.
   */
  private async assertAgentBelongsToOrg(
    organizationId: string,
    agentId?: string,
  ): Promise<void> {
    if (!agentId) return;

    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, organizationId },
      select: { id: true },
    });
    if (!agent) {
      throw new BadRequestException(
        'Agente inexistente o de otra organización',
      );
    }
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

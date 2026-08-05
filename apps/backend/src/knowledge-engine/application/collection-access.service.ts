import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Acceso de una PERSONA a colecciones de conocimiento — subfase 5.8.
 *
 * Hasta la Fase 5 el alcance de colección solo existía para agentes. El Understanding
 * Engine, en cambio, acota la comprensión y las `Recommendation` derivadas de ella por
 * `EffectiveCollectionScope` (§3.4, §12), y esa regla se compara contra las colecciones que
 * el consumidor tiene concedidas. Cuando el consumidor es una persona, esta es la fuente de
 * verdad de qué tiene concedido.
 *
 * **El acceso se concede, nunca se presupone** (KNOWLEDGE_ENGINE_DESIGN.md §535). No tener
 * ninguna concesión significa no tener acceso a ninguna colección, no a todas. Es la misma
 * elección que hace `RunAgentUseCase` al negarse a ejecutar un agente sin alcance: la
 * alternativa convierte el descuido de configuración más fácil de cometer en acceso total,
 * y de forma indistinguible del funcionamiento correcto.
 */
@Injectable()
export class CollectionAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Colecciones concedidas a una persona en una organización.
   *
   * Devuelve una lista, posiblemente vacía. Que esté vacía NO es un error: es la respuesta
   * correcta para quien no tiene nada concedido, y quien la consume debe tratarla como
   * "acceso a nada".
   */
  async accessibleCollectionIds(params: {
    organizationId: string;
    userId: string;
  }): Promise<string[]> {
    const grants = await this.prisma.knowledgeCollectionAccess.findMany({
      where: {
        organizationId: params.organizationId,
        userId: params.userId,
      },
      select: { knowledgeCollectionId: true },
    });

    return grants.map((grant) => grant.knowledgeCollectionId);
  }

  /**
   * Concede una colección a un miembro de la organización.
   *
   * Idempotente: conceder dos veces deja una sola concesión. La FK compuesta contra
   * `(id, organizationId)` de la colección hace imposible conceder una de otra organización;
   * aquí se traduce ese fallo de integridad a un error explicable en vez de dejar escapar
   * una violación de restricción sin contexto.
   */
  async grant(params: {
    organizationId: string;
    knowledgeCollectionId: string;
    userId: string;
    grantedById: string;
  }): Promise<{ knowledgeCollectionId: string; userId: string }> {
    await this.assertMemberOfOrg(params.organizationId, params.userId);

    try {
      await this.prisma.knowledgeCollectionAccess.upsert({
        where: {
          knowledgeCollectionId_userId: {
            knowledgeCollectionId: params.knowledgeCollectionId,
            userId: params.userId,
          },
        },
        create: {
          organizationId: params.organizationId,
          knowledgeCollectionId: params.knowledgeCollectionId,
          userId: params.userId,
          grantedById: params.grantedById,
        },
        // Conceder lo ya concedido no reescribe quién lo concedió ni cuándo: la traza de la
        // concesión original es lo que explica por qué esa persona tiene acceso hoy.
        update: {},
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Colección inexistente o de otra organización',
        );
      }
      throw error;
    }

    return {
      knowledgeCollectionId: params.knowledgeCollectionId,
      userId: params.userId,
    };
  }

  /** Retira una concesión. Retirar lo que no estaba concedido no es un error. */
  async revoke(params: {
    organizationId: string;
    knowledgeCollectionId: string;
    userId: string;
  }): Promise<{ revoked: number }> {
    const { count } = await this.prisma.knowledgeCollectionAccess.deleteMany({
      where: {
        organizationId: params.organizationId,
        knowledgeCollectionId: params.knowledgeCollectionId,
        userId: params.userId,
      },
    });

    return { revoked: count };
  }

  /** Quién tiene acceso a una colección concreta. */
  async listForCollection(params: {
    organizationId: string;
    knowledgeCollectionId: string;
  }): Promise<
    { userId: string; grantedById: string | null; createdAt: Date }[]
  > {
    return this.prisma.knowledgeCollectionAccess.findMany({
      where: {
        organizationId: params.organizationId,
        knowledgeCollectionId: params.knowledgeCollectionId,
      },
      select: { userId: true, grantedById: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Conceder acceso a quien no pertenece a la organización sería crear un permiso para
   * alguien que no debería tener ninguno. La FK contra `Membership` ya lo impediría; esto
   * lo convierte en un error explicable en vez de en una violación de restricción.
   */
  private async assertMemberOfOrg(
    organizationId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException(
        'El usuario no pertenece a esta organización',
      );
    }
  }
}

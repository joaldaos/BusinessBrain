import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CollectionAccessService } from './collection-access.service';

/**
 * Retira de la respuesta lo que es metadata OPERATIVA.
 *
 * `sourceMetadata` sirve para sincronizar, agrupar y trazar, y por decisión de producto queda
 * fuera de lo que se recupera. Hoy contiene la dirección de correo del remitente de un mensaje
 * de Gmail — dato personal que no debe salir en una respuesta HTTP por el mero hecho de estar
 * guardado en la misma fila que el contenido.
 *
 * Se hace quitando lo prohibido y no enumerando lo permitido a propósito: con una lista de
 * campos permitidos, cada columna nueva del contenido dejaría de aparecer en silencio. Aquí lo
 * que no debe salir se nombra explícitamente, y lo demás sale por defecto.
 */
function withoutOperationalMetadata<T extends { sourceMetadata?: unknown }>(
  item: T,
): Omit<T, 'sourceMetadata'> {
  const { sourceMetadata, ...visible } = item;
  // Se nombra para separarlo y se descarta aquí mismo: es lo que NO sale.
  void sourceMetadata;

  return visible;
}

/**
 * Lectura de `KnowledgeItem`.
 *
 * ## Acotado por ALCANCE, no solo por organización
 *
 * Filtrar por tenant no basta. Un `KnowledgeItem` pertenece a colecciones, y esas colecciones
 * son lo que decide quién puede leerlo: sin este filtro, cualquier miembro de la organización
 * vería el contenido de una colección restringida con solo pedir la lista, por mucho que el
 * motor de comprensión respetara el alcance por su cuenta. Con un buzón de correo detrás, eso
 * significa el correo de una persona a la vista de toda la empresa.
 *
 * **Fail-closed**: un ítem sin ninguna colección tiene alcance efectivo vacío y no se sirve a
 * nadie. Es la misma regla que aplica `RetrieveInsights`, y aquí no puede ser más laxa — sería
 * la puerta de atrás de la otra.
 *
 * En esta subfase no hay escritura de dominio propia: los ítems se crean exclusivamente a
 * través de `IngestFromSourceUseCase`.
 */
@Injectable()
export class KnowledgeItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CollectionAccessService,
  ) {}

  async findAll(organizationId: string, actorUserId: string) {
    const items = await this.prisma.knowledgeItem.findMany({
      where: await this.withinScope(organizationId, actorUserId),
      orderBy: { createdAt: 'desc' },
    });

    return items.map(withoutOperationalMetadata);
  }

  /**
   * Incluye procedencia (fuente + job de ingesta que lo originó) para cumplir el criterio de
   * validación de la subfase 2.1: "producir un KnowledgeItem normalizado, trazable a su job"
   * (KNOWLEDGE_ENGINE_DESIGN.md §19, subfase 2.1). Desde la subfase 2.2 incluye también el grafo
   * de linaje (§3.7, §6): qué ítem reemplazó a este (si aplica) y a qué ítem reemplazó este, para
   * que la trazabilidad de versiones sea consultable sin acceso directo a la base de datos.
   */
  async findOne(
    organizationId: string,
    actorUserId: string,
    knowledgeItemId: string,
  ) {
    const item = await this.prisma.knowledgeItem.findFirst({
      where: {
        id: knowledgeItemId,
        ...(await this.withinScope(organizationId, actorUserId)),
      },
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
      // Mismo 404 para "no existe" y "no es tuyo": distinguirlos confirmaría la existencia de
      // un documento de una colección que no se ha concedido.
      throw new NotFoundException('KnowledgeItem no encontrado');
    }
    return withoutOperationalMetadata(item);
  }

  /** Filtro de alcance: organización Y alguna colección concedida al actor. */
  private async withinScope(organizationId: string, actorUserId: string) {
    const collectionIds = await this.access.accessibleCollectionIds({
      organizationId,
      userId: actorUserId,
    });

    return {
      organizationId,
      knowledgeItemCollections: {
        some: { knowledgeCollectionId: { in: collectionIds } },
      },
    };
  }
}

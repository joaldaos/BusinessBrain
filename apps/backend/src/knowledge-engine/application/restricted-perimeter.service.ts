import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { evaluateRestrictedPerimeter } from '../domain/restricted-collection';
import { ConnectorRegistry } from '../infrastructure/connectors/connector-registry.service';

/**
 * Exige el perímetro de acceso restringido a las fuentes que lo declaran.
 *
 * Se comprueba **al crear la fuente y en cada sincronización**, y las dos veces son necesarias
 * por motivos distintos: al crearla, para que no llegue a existir una fuente sin perímetro; al
 * sincronizar, porque las concesiones cambian después — basta con que alguien conceda esa
 * colección a toda la organización para que el perímetro desaparezca sin que nadie toque la
 * fuente. Sin la segunda comprobación, la garantía valdría solo en el instante de la creación.
 *
 * Vive en un servicio propio, y no dentro de `KnowledgeSourcesService`, precisamente porque lo
 * necesitan dos capas distintas: la que crea la fuente y la que la sincroniza.
 */
@Injectable()
export class RestrictedPerimeterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConnectorRegistry,
  ) {}

  /**
   * Falla si el conector exige perímetro y el declarado no lo es. Si no lo exige, no hay nada
   * que exigir: una carpeta compartida o una URL pública no plantean este problema.
   */
  async assertPerimeterFor(params: {
    organizationId: string;
    connectorKey: string;
    collectionIds: string[];
  }): Promise<void> {
    const connector = this.registry.get(params.connectorKey);
    if (!connector.requiresRestrictedCollection) return;

    const [grantedUserCount, organizationMemberCount] = await Promise.all([
      // Solo tiene sentido contar accesos cuando hay exactamente una colección; con ninguna o
      // con varias, el dominio ya rechaza antes de mirar a quién se concedió.
      params.collectionIds.length === 1
        ? this.prisma.knowledgeCollectionAccess.count({
            where: {
              organizationId: params.organizationId,
              knowledgeCollectionId: params.collectionIds[0],
            },
          })
        : Promise.resolve(0),
      this.prisma.membership.count({
        where: { organizationId: params.organizationId },
      }),
    ]);

    const decision = evaluateRestrictedPerimeter({
      collectionIds: params.collectionIds,
      grantedUserCount,
      organizationMemberCount,
    });

    if (!decision.allowed) {
      throw new BadRequestException(decision.explanation);
    }
  }

  /** Colecciones de destino de una fuente ya creada. */
  async collectionIdsOf(params: {
    organizationId: string;
    knowledgeSourceId: string;
  }): Promise<string[]> {
    const rows = await this.prisma.knowledgeSourceCollection.findMany({
      where: {
        organizationId: params.organizationId,
        knowledgeSourceId: params.knowledgeSourceId,
      },
      select: { knowledgeCollectionId: true },
    });

    return rows.map((row) => row.knowledgeCollectionId);
  }
}

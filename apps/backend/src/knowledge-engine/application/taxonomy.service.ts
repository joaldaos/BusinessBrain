import { Injectable, Logger } from '@nestjs/common';
import type { TaxonomyNode } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { FACTORY_TAXONOMY } from '../domain/taxonomy.seed';

/**
 * Gestiona la taxonomía jerárquica por organización — KNOWLEDGE_ENGINE_DESIGN.md §9.
 *
 * Siembra la raíz común de fábrica y resuelve nodos por clave. Las subcategorías propias
 * de cada organización se añaden sobre ese árbol; los nodos de fábrica (`isSystem`) no se
 * borran ni se renombran.
 */
@Injectable()
export class TaxonomyService {
  private readonly logger = new Logger(TaxonomyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Garantiza que la organización tiene la taxonomía de fábrica sembrada. Idempotente: se
   * puede llamar en cada ingesta sin duplicar nada, y es seguro bajo concurrencia gracias
   * a la restricción única (organizationId, key).
   *
   * Los nodos se crean por niveles (padres antes que hijos) para poder enlazar `parentId`
   * sin depender del orden del array de semilla.
   */
  async ensureSeeded(organizationId: string): Promise<void> {
    const existing = await this.prisma.taxonomyNode.count({
      where: { organizationId, isSystem: true },
    });
    if (existing >= FACTORY_TAXONOMY.length) {
      return;
    }

    const byDepth = [...FACTORY_TAXONOMY].sort(
      (a, b) => a.key.split('.').length - b.key.split('.').length,
    );

    for (const node of byDepth) {
      const parent = node.parentKey
        ? await this.prisma.taxonomyNode.findUnique({
            where: {
              organizationId_key: { organizationId, key: node.parentKey },
            },
          })
        : null;

      await this.prisma.taxonomyNode.upsert({
        where: { organizationId_key: { organizationId, key: node.key } },
        // Un nodo ya sembrado no se toca: si la organización renombró una etiqueta propia
        // sobre un nodo de sistema, resembrar no debe pisarla.
        update: {},
        create: {
          organizationId,
          key: node.key,
          label: node.label,
          businessArea: node.businessArea,
          parentId: parent?.id ?? null,
          isSystem: true,
        },
      });
    }

    this.logger.log(
      `Taxonomía de fábrica sembrada para la organización ${organizationId}`,
    );
  }

  /** Todos los nodos de la organización, para ofrecer el vocabulario al clasificador. */
  async listNodes(organizationId: string): Promise<TaxonomyNode[]> {
    return this.prisma.taxonomyNode.findMany({
      where: { organizationId },
      orderBy: { key: 'asc' },
    });
  }

  async findByKey(
    organizationId: string,
    key: string,
  ): Promise<TaxonomyNode | null> {
    return this.prisma.taxonomyNode.findUnique({
      where: { organizationId_key: { organizationId, key } },
    });
  }
}

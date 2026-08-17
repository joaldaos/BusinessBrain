import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/utils/encryption.util';
import { RestrictedPerimeterService } from './restricted-perimeter.service';
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
  integrationId: true,
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
    private readonly perimeter: RestrictedPerimeterService,
  ) {}

  async create(
    organizationId: string,
    createdById: string,
    dto: CreateKnowledgeSourceDto,
  ) {
    const collectionIds = [...new Set(dto.knowledgeCollectionIds ?? [])];
    await this.assertCollectionsBelongToOrg(organizationId, collectionIds);
    await this.assertIntegrationBelongsToOrg(organizationId, dto.integrationId);
    // Estructural: una fuente que exige perímetro restringido no llega a existir sin él. Se
    // vuelve a exigir en cada sincronización, porque las concesiones cambian después.
    await this.perimeter.assertPerimeterFor({
      organizationId,
      connectorKey: dto.connectorKey,
      collectionIds,
    });

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
          integrationId: dto.integrationId ?? null,
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
  /**
   * La conexión declarada debe ser de ESTA organización.
   *
   * La clave foránea compuesta ya lo impide en la base de datos; aquí se traduce a un error
   * explicable en vez de dejar escapar una violación de restricción sin contexto.
   */
  private async assertIntegrationBelongsToOrg(
    organizationId: string,
    integrationId?: string,
  ): Promise<void> {
    if (!integrationId) return;

    const found = await this.prisma.integration.count({
      where: { id: integrationId, organizationId },
    });
    if (found === 0) {
      throw new BadRequestException(
        'La conexión indicada no existe o pertenece a otra organización',
      );
    }
  }

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
    const sources = await this.prisma.knowledgeSource.findMany({
      where: { organizationId },
      select: { ...PUBLIC_SELECT, configEnc: true, ...LAST_JOB_SELECT },
      orderBy: { createdAt: 'desc' },
    });

    return sources.map((source) => this.describe(source));
  }

  async findOne(organizationId: string, knowledgeSourceId: string) {
    const source = await this.prisma.knowledgeSource.findFirst({
      where: { id: knowledgeSourceId, organizationId },
      select: { ...PUBLIC_SELECT, configEnc: true, ...LAST_JOB_SELECT },
    });
    if (!source) {
      throw new NotFoundException('KnowledgeSource no encontrada');
    }
    return this.describe(source);
  }

  /**
   * Lo que la interfaz puede contar de una fuente.
   *
   * `configEnc` se lee aquí y **no se devuelve**: de él sale solo la frontera sincronizada, en
   * texto, a través de una lista blanca por conector. Devolver la config entera expondría
   * secretos de otras fuentes presentes o futuras; no devolver nada dejaría a la persona sin
   * saber QUÉ etiqueta o carpeta está entrando, que es la mitad de la decisión que tomó.
   */
  private describe<T extends { configEnc: string; connectorKey: string }>(
    source: T & { ingestionJobs?: LastJob[] },
  ) {
    const { configEnc, ingestionJobs, ...visible } = source;
    const [lastJob] = ingestionJobs ?? [];

    return {
      ...visible,
      syncScope: describeSyncScope(
        visible.connectorKey,
        this.readConfig(configEnc),
      ),
      // Qué pasó en la última ejecución: cuántos entraron, cuántos se actualizaron y qué
      // falló. Sin esto, "sincronizado" no distingue traer 40 documentos de no traer ninguno.
      lastSync: lastJob
        ? {
            status: lastJob.status,
            finishedAt: lastJob.finishedAt,
            stats: lastJob.stats,
            error: lastJob.error,
          }
        : null,
    };
  }

  /** Config descifrada. Una config ilegible no rompe el listado: se describe como vacía. */
  private readConfig(configEnc: string): Record<string, unknown> {
    if (!configEnc) return {};
    try {
      const parsed: unknown = JSON.parse(this.encryption.decrypt(configEnc));
      return typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}

export interface LastJob {
  status: string;
  finishedAt: Date | null;
  stats: unknown;
  error: string | null;
}

/** Última ejecución de ingesta, para poder decir qué trajo. */
const LAST_JOB_SELECT = {
  ingestionJobs: {
    select: { status: true, finishedAt: true, stats: true, error: true },
    orderBy: { startedAt: 'desc' },
    take: 1,
  },
} as const;

/**
 * Frontera sincronizada de una fuente, en texto legible.
 *
 * Lista blanca por conector, y no un volcado de la config: la config puede contener secretos
 * —hoy no, mañana sí— y una fuente nueva no debe empezar a filtrar la suya por el hecho de
 * existir. Lo que no está aquí, no se cuenta.
 */
function describeSyncScope(
  connectorKey: string,
  config: Record<string, unknown>,
): string | null {
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null;

  switch (connectorKey) {
    case 'gmail_v1':
      return text(config.labelName) ?? text(config.labelId);
    case 'web_page_v1':
      return text(config.url);
    case 'google_drive_v1':
      return text(config.folderName) ?? text(config.folderId);
    default:
      return null;
  }
}

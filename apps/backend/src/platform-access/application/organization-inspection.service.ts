import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Lo que se ve de una empresa en cada alcance.
 *
 * ## Tres consultas separadas, no una con condicionales
 *
 * Cada método corresponde exactamente a un alcance y devuelve lo suyo. Una sola consulta que
 * fuera añadiendo campos según el permiso sería más corta y mucho peor: bastaría con un
 * `if` mal puesto para que un acceso a metadatos devolviera contenido, y ese fallo no se vería
 * leyendo el código de la ruta.
 *
 * Aquí, la ruta de metadatos **no tiene forma de devolver texto de un documento**, porque la
 * consulta que la sirve no lo selecciona.
 */
@Injectable()
export class OrganizationInspectionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * METADATA: nombres, contadores y estados. Ni una línea de contenido.
   *
   * Es lo que permite responder "¿esta empresa está usando el producto?" o "¿por qué dice que
   * no le entra nada?" sin abrir un solo documento suyo.
   */
  async overview(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, planTier: true, createdAt: true },
    });
    if (!organization)
      throw new NotFoundException('Organización no encontrada');

    const [miembros, documentos, colecciones, fuentes, conclusiones] =
      await Promise.all([
        this.prisma.membership.count({ where: { organizationId } }),
        this.prisma.knowledgeItem.count({ where: { organizationId } }),
        this.prisma.knowledgeCollection.count({ where: { organizationId } }),
        this.prisma.knowledgeSource.findMany({
          where: { organizationId },
          // El NOMBRE de la fuente y su estado. Ni `configEnc` —que lleva credenciales— ni
          // nada que se acerque al contenido que trae.
          select: {
            id: true,
            name: true,
            type: true,
            status: true,
            lastSyncedAt: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.insight.count({ where: { organizationId } }),
      ]);

    return {
      organization,
      counts: { miembros, documentos, colecciones, conclusiones },
      sources: fuentes,
    };
  }

  /**
   * DIAGNOSTICS: por qué algo no funciona.
   *
   * Los mensajes de error se devuelven tal cual porque son lo que permite diagnosticar. Un
   * error de ingesta puede citar el NOMBRE del fichero que falló —no se puede investigar "un
   * documento falló" sin saber cuál— pero nunca su contenido: aquí no se selecciona el texto
   * de ningún documento, y esta consulta no tiene forma de devolverlo.
   */
  async diagnostics(organizationId: string) {
    const [fuentesConError, trabajos] = await Promise.all([
      this.prisma.knowledgeSource.findMany({
        where: { organizationId, NOT: { lastError: null } },
        select: {
          id: true,
          name: true,
          status: true,
          lastError: true,
          lastSyncedAt: true,
        },
      }),
      this.prisma.ingestionJob.findMany({
        where: { organizationId },
        orderBy: { startedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          knowledgeSourceId: true,
          status: true,
          error: true,
          stats: true,
          startedAt: true,
          finishedAt: true,
        },
      }),
    ]);

    const analisis = await this.prisma.analysisRun.findMany({
      where: { organizationId, status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, error: true, createdAt: true },
    });

    return {
      failingSources: fuentesConError,
      recentJobs: trabajos,
      failedAnalyses: analisis,
    };
  }

  /**
   * CONTENT: los documentos de la empresa.
   *
   * El único alcance que devuelve lo que la empresa escribió, y por eso el único que exige que
   * su propietario lo apruebe. El listado da títulos; el texto hay que pedirlo documento a
   * documento, para que la traza registre exactamente cuál se leyó y no "se abrió la lista".
   */
  async documents(organizationId: string) {
    return this.prisma.knowledgeItem.findMany({
      where: { organizationId },
      select: {
        id: true,
        title: true,
        status: true,
        businessArea: true,
        indexedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async document(organizationId: string, knowledgeItemId: string) {
    const item = await this.prisma.knowledgeItem.findFirst({
      // Acotado por organización: pedir un documento de otra empresa con una concesión de
      // esta devuelve "no encontrado", no el documento.
      where: { id: knowledgeItemId, organizationId },
      select: {
        id: true,
        title: true,
        contentText: true,
        status: true,
        businessArea: true,
        indexedAt: true,
      },
    });
    if (!item) throw new NotFoundException('Documento no encontrado');
    return item;
  }
}

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

    const [
      miembros,
      documentos,
      colecciones,
      fuentes,
      conclusiones,
      conectores,
      hechos,
    ] = await Promise.all([
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
      /*
       * Los conectores de hechos — Fase 9B.
       *
       * Hasta aquí la plataforma no sabía ni que existían, así que un administrador no podía
       * responder "¿por qué este cliente dice que su TPV no entra?" sin pedirle acceso a su
       * contenido, que es desproporcionado para una avería de conexión.
       *
       * Qué conector, cómo está y cuándo leyó por última vez. **Nada del secreto**: ni
       * `secretEnc`, ni la configuración, ni el marcador de sincronización —que no es un
       * secreto pero tampoco le dice nada a nadie—. Hay una prueba estructural que impide
       * que esta consulta llegue a nombrar una columna cifrada.
       */
      this.prisma.organizationConnector.findMany({
        where: { organizationId },
        select: {
          id: true,
          connectorKey: true,
          displayName: true,
          status: true,
          lastSyncedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.businessEvent.count({ where: { organizationId } }),
    ]);

    return {
      organization,
      counts: { miembros, documentos, colecciones, conclusiones, hechos },
      sources: fuentes,
      connectors: conectores,
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

    /*
     * Lo mismo para los conectores de hechos.
     *
     * `lastError` se devuelve tal cual porque es lo que permite diagnosticar —«credenciales
     * rechazadas», «el TPV no responde»—. Lo que nunca aparece es el secreto con el que se
     * intentó, ni los hechos que la sincronización traía: `stats` son recuentos, no datos.
     */
    const [conectoresConError, sincronizaciones] = await Promise.all([
      this.prisma.organizationConnector.findMany({
        where: { organizationId, NOT: { lastError: null } },
        select: {
          id: true,
          connectorKey: true,
          displayName: true,
          status: true,
          lastError: true,
          lastSyncedAt: true,
        },
      }),
      this.prisma.connectorSync.findMany({
        where: { organizationId },
        orderBy: { startedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          connectorId: true,
          trigger: true,
          status: true,
          error: true,
          stats: true,
          startedAt: true,
          finishedAt: true,
        },
      }),
    ]);

    /*
     * Y los trabajos MUERTOS de la cola.
     *
     * Son, por definición, los que hay que mirar: agotaron sus intentos o nadie supo
     * atenderlos. Sin esto, un administrador ve "la sincronización no ocurre" y no tiene
     * dónde averiguar por qué. Se devuelve el tipo y el error, **nunca el contenido del
     * trabajo**: aunque la regla es que ahí no van secretos, un diagnóstico no es sitio para
     * comprobar si alguien la cumplió.
     */
    const trabajosMuertos = await this.prisma.job.findMany({
      where: { organizationId, status: 'DEAD' },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        kind: true,
        attempts: true,
        lastError: true,
        updatedAt: true,
      },
    });

    return {
      failingSources: fuentesConError,
      recentJobs: trabajos,
      failedAnalyses: analisis,
      failingConnectors: conectoresConError,
      recentSyncs: sincronizaciones,
      deadJobs: trabajosMuertos,
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

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CollectionAccessService } from '../../knowledge-engine/application/collection-access.service';
import { evaluateCollectionScopeCoverage } from '../domain/collection-scope-coverage';

/**
 * Alcance efectivo de un `Insight` y autorización del actor — §3.4, §12. Subfase 6.1.
 *
 * Existe por dos motivos, y ninguno es organizativo.
 *
 * **Uno: la proyección estaba duplicada.** `RetrieveInsights` y `CurateInsight` calculaban
 * cada uno el `EffectiveCollectionScope` por su cuenta, con el mismo código escrito dos
 * veces. Al aparecer el tercer consumidor —la autorización del actor— la duplicación pasaba a
 * ser un riesgo real: dos definiciones de un alcance son dos criterios, y basta con que una
 * se toque para que la misma evidencia autorice cosas distintas según por dónde se entre.
 *
 * **Dos: curar y escalar no comprobaban el alcance del actor.** Hasta 6.1 ambos casos de uso
 * solo filtraban por organización, y eran inalcanzables por HTTP, así que no era explotable.
 * Exponerlos sin esta comprobación habría abierto dos agujeros:
 *
 * - *Curar fuera de alcance*: la curación humana tiene PRIORIDAD sobre el recálculo
 *   automático (§3.7), así que confirmar o descartar un `Insight` que no puedes leer es una
 *   escritura duradera sobre comprensión ajena.
 * - *Escalar fuera de alcance*: crearía una `Recommendation` cuyo alcance efectivo incluye
 *   colecciones que el actor no puede ver, redactada por él. Es la vía de blanqueo que §12
 *   cierra en la propagación pero no en la autorización de quien la dispara.
 *
 * La regla de comparación NO vive aquí: es dominio puro (`collection-scope-coverage.ts`).
 * Aquí solo se resuelven los hechos contra la base de datos y se traduce la decisión a HTTP.
 */
@Injectable()
export class InsightScopeService {
  private readonly logger = new Logger(InsightScopeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly collectionAccess: CollectionAccessService,
  ) {}

  /**
   * Proyección VIVA del alcance de colección sobre la pertenencia ACTUAL de la evidencia
   * (§3.4), nunca sobre una copia registrada al generarse el `Insight`.
   *
   * Definición única del sistema: cualquier otro cálculo del mismo alcance es un error.
   */
  async effectiveScopeOf(
    organizationId: string,
    transitiveEvidenceClosure: unknown,
  ): Promise<string[]> {
    const refIds = this.closureRefIds(transitiveEvidenceClosure);
    if (refIds.length === 0) return [];

    const memberships = await this.prisma.knowledgeItemCollection.findMany({
      where: { knowledgeItem: { id: { in: refIds }, organizationId } },
      select: { knowledgeCollectionId: true },
    });

    return [...new Set(memberships.map((m) => m.knowledgeCollectionId))];
  }

  /**
   * Exige que el actor cubra por completo el alcance del `Insight`.
   *
   * Lanza 403 explicando qué falta. Dentro de la organización la persona sí tiene derecho a
   * saber que existe algo que no puede ver y por qué; lo que nunca debe poder distinguir es
   * eso mismo desde FUERA del tenant, y de eso se encarga el filtro de organización que
   * aplica quien llama antes de llegar aquí.
   */
  async assertActorCoversInsight(params: {
    organizationId: string;
    actorUserId: string;
    insightId: string;
    transitiveEvidenceClosure: unknown;
  }): Promise<string[]> {
    const [effectiveCollectionScope, allowedCollectionIds] = await Promise.all([
      this.effectiveScopeOf(
        params.organizationId,
        params.transitiveEvidenceClosure,
      ),
      this.collectionAccess.accessibleCollectionIds({
        organizationId: params.organizationId,
        userId: params.actorUserId,
      }),
    ]);

    const decision = evaluateCollectionScopeCoverage({
      effectiveCollectionScope,
      allowedCollectionIds,
    });

    if (!decision.allowed) {
      this.logger.warn(
        `Acceso denegado al Insight ${params.insightId} para el usuario ` +
          `${params.actorUserId}: ${decision.reason}`,
      );
      throw new ForbiddenException(decision.explanation);
    }

    return effectiveCollectionScope;
  }

  /**
   * Igual que `assertActorCoversInsight`, resolviendo el `Insight` por identificador.
   *
   * Distingue 404 de 403 a propósito: fuera de la organización no debe poder saberse que algo
   * existe; dentro, la persona sí tiene derecho a saber que hay comprensión que no puede ver
   * y qué colecciones le faltan.
   *
   * Vive aquí y no en el controlador porque consultar `Insight` directamente desde la capa
   * de API abriría un segundo camino a la comprensión, y el único punto de lectura del
   * sistema es `RetrieveInsights` (§12). Esta consulta no devuelve contenido: solo resuelve
   * existencia y alcance para poder responder con el código correcto.
   */
  async assertActorCoversInsightById(params: {
    organizationId: string;
    actorUserId: string;
    insightId: string;
  }): Promise<void> {
    const insight = await this.prisma.insight.findFirst({
      where: { id: params.insightId, organizationId: params.organizationId },
      select: { id: true, transitiveEvidenceClosure: true },
    });
    if (!insight) throw new NotFoundException('Insight no encontrado');

    await this.assertActorCoversInsight({
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      insightId: insight.id,
      transitiveEvidenceClosure: insight.transitiveEvidenceClosure,
    });
  }

  private closureRefIds(closure: unknown): string[] {
    return Array.isArray(closure)
      ? (closure as { refId?: unknown }[])
          .map((entry) => entry?.refId)
          .filter((refId): refId is string => typeof refId === 'string')
      : [];
  }
}

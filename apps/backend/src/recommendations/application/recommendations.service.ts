import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  RecommendationStatus,
  type Recommendation,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { CollectionAccessService } from '../../knowledge-engine/application/collection-access.service';
import { evaluateRecommendationAccess } from '../domain/recommendation-access';

/**
 * `RecommendationsModule` — BUSINESSBRAIN_MIGRATION_PLAN.md §7.2, subfase 5.8.
 *
 * **Ciclo de vida y superficie de lectura. NUNCA generación.**
 *
 * Una `Recommendation` solo nace en `EscalateInsightToRecommendation` (§11, §12), a partir
 * de un `Insight` que articula una acción concreta. Este módulo no tiene ninguna vía de
 * creación, y eso es una decisión de arquitectura, no una omisión: dos productores de
 * propuestas serían dos mecanismos redundantes resolviendo "proponer algo a la empresa", el
 * riesgo que §11 cierra explícitamente. Aquí solo se lee, se acepta y se descarta.
 *
 * **Aceptar NO ejecuta nada.** Es coherente con "siempre propone, nunca modifica
 * automáticamente" (§2). Aceptar registra una decisión humana —quién y cuándo— y termina.
 * No hay tools inyectadas en este servicio, ni llamadas a agentes, ni disparo de
 * automatizaciones: no existe el camino de código que produciría un efecto externo, que es
 * una garantía mucho más fuerte que la de no recorrerlo.
 *
 * **El `effectiveCollectionScope` se respeta siempre**, con la MISMA regla de cobertura
 * completa de `RetrieveInsights` (§3.4, §12). Dos criterios distintos para el mismo alcance
 * significarían que una conclusión restringida se vuelve visible según por qué puerta se entre.
 */

export interface RecommendationView extends Recommendation {
  /** Trazabilidad hasta la comprensión que la originó (§21, hallazgo 12). */
  sourceInsight: {
    id: string;
    summary: string;
    status: string;
    confidence: number;
  } | null;
  resolvedBy: { id: string; name: string; email: string } | null;
}

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly collectionAccess: CollectionAccessService,
  ) {}

  /**
   * Recomendaciones accesibles para una persona.
   *
   * Las que no cubre su alcance no aparecen: no se listan "bloqueadas". Un listado que
   * revelara título y motivo de denegación filtraría justo lo que el alcance protege.
   */
  async list(params: {
    organizationId: string;
    userId: string;
    status?: RecommendationStatus;
    limit?: number;
  }): Promise<RecommendationView[]> {
    const allowedCollectionIds =
      await this.collectionAccess.accessibleCollectionIds({
        organizationId: params.organizationId,
        userId: params.userId,
      });

    const recommendations = await this.prisma.recommendation.findMany({
      where: {
        // Filtro de organización: primero y sin excepción.
        organizationId: params.organizationId,
        ...(params.status ? { status: params.status } : {}),
      },
      include: this.viewInclude,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    const accessible = recommendations.filter(
      (recommendation) =>
        evaluateRecommendationAccess({
          effectiveCollectionScope: recommendation.effectiveCollectionScope,
          allowedCollectionIds,
        }).allowed,
    );

    return accessible
      .slice(0, params.limit ?? 50)
      .map((recommendation) => this.toView(recommendation));
  }

  /**
   * Una recomendación por id.
   *
   * La de otra organización responde 404, no 403: fuera del tenant no debe poder
   * distinguirse "no existe" de "no es tuya". Dentro de la organización, en cambio, el
   * alcance insuficiente responde 403 y explica qué falta — ahí la persona sí tiene derecho
   * a saber que existe algo que no puede ver, y por qué.
   */
  async findOne(params: {
    organizationId: string;
    userId: string;
    recommendationId: string;
  }): Promise<RecommendationView> {
    const recommendation = await this.loadAuthorized(params);

    return this.toView(recommendation);
  }

  /**
   * Aceptar: decisión humana de dar por buena la propuesta.
   *
   * **No ejecuta absolutamente nada.** No crea tools, no dispara automatizaciones, no
   * modifica el sistema ni el negocio. Deja constancia de quién la aceptó y cuándo, y ahí
   * termina su efecto.
   */
  async accept(params: {
    organizationId: string;
    userId: string;
    recommendationId: string;
  }): Promise<RecommendationView> {
    return this.resolve(params, RecommendationStatus.ACCEPTED);
  }

  /** Descartar: la otra mitad de la misma decisión humana, con la misma traza. */
  async dismiss(params: {
    organizationId: string;
    userId: string;
    recommendationId: string;
  }): Promise<RecommendationView> {
    return this.resolve(params, RecommendationStatus.DISMISSED);
  }

  private async resolve(
    params: {
      organizationId: string;
      userId: string;
      recommendationId: string;
    },
    status: RecommendationStatus,
  ): Promise<RecommendationView> {
    const recommendation = await this.loadAuthorized(params);

    // Una decisión ya tomada no se sobrescribe: hacerlo borraría quién decidió y cuándo,
    // que es justamente lo que esta subfase existe para conservar. Cambiar de opinión es
    // una operación distinta y con su propia traza, no un segundo `accept` silencioso.
    if (recommendation.status !== RecommendationStatus.NEW) {
      throw new ConflictException(
        `La recomendación ya fue resuelta como ${recommendation.status}` +
          (recommendation.resolvedAt
            ? ` el ${recommendation.resolvedAt.toISOString()}`
            : ''),
      );
    }

    const updated = await this.prisma.recommendation.update({
      where: { id: recommendation.id },
      data: {
        status,
        resolvedById: params.userId,
        resolvedAt: new Date(),
      },
      include: this.viewInclude,
    });

    this.logger.log(
      `Recomendación ${updated.id} ${status} por el usuario ${params.userId} — ` +
        'ninguna acción externa ejecutada',
    );

    return this.toView(updated);
  }

  /**
   * Carga acotada por organización Y por alcance efectivo. Único punto por el que pasan
   * todas las lecturas y las dos decisiones: si la comprobación viviera en cada método,
   * bastaría con que uno nuevo la olvidara.
   */
  private async loadAuthorized(params: {
    organizationId: string;
    userId: string;
    recommendationId: string;
  }) {
    const recommendation = await this.prisma.recommendation.findFirst({
      where: {
        id: params.recommendationId,
        organizationId: params.organizationId,
      },
      include: this.viewInclude,
    });
    if (!recommendation) {
      throw new NotFoundException('Recomendación no encontrada');
    }

    const allowedCollectionIds =
      await this.collectionAccess.accessibleCollectionIds({
        organizationId: params.organizationId,
        userId: params.userId,
      });

    const decision = evaluateRecommendationAccess({
      effectiveCollectionScope: recommendation.effectiveCollectionScope,
      allowedCollectionIds,
    });
    if (!decision.allowed) {
      this.logger.warn(
        `Acceso denegado a la recomendación ${recommendation.id} para el usuario ` +
          `${params.userId}: ${decision.reason}`,
      );
      throw new ForbiddenException(decision.explanation);
    }

    return recommendation;
  }

  private readonly viewInclude = {
    sourceInsight: {
      select: { id: true, summary: true, status: true, confidence: true },
    },
    resolvedBy: { select: { id: true, name: true, email: true } },
  };

  private toView(
    recommendation: Recommendation & {
      sourceInsight: {
        id: string;
        summary: string;
        status: string;
        confidence: number;
      } | null;
      resolvedBy: { id: string; name: string; email: string } | null;
    },
  ): RecommendationView {
    return recommendation;
  }
}

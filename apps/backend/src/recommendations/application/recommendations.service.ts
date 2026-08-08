import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
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

/** Tamaño de página por defecto y techo duro: una petición no puede pedir "todo". */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

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
    offset?: number;
  }): Promise<RecommendationView[]> {
    const allowedCollectionIds =
      await this.collectionAccess.accessibleCollectionIds({
        organizationId: params.organizationId,
        userId: params.userId,
      });

    const limit = Math.min(params.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = Math.max(params.offset ?? 0, 0);

    // El alcance se aplica EN POSTGRES, no en memoria. Antes se cargaban todas las
    // recomendaciones de la organización y se recortaba después: la página era correcta pero
    // el coste crecía con el tamaño del tenant, y el `limit` no acotaba nada del trabajo real.
    //
    // `<@` es "contenido en": el alcance efectivo debe ser un subconjunto de lo concedido, que
    // es literalmente la regla de cobertura completa (§3.4). `cardinality(...) > 0` mantiene
    // el fail-closed del alcance vacío. Ambas condiciones son las MISMAS que evalúa el
    // dominio, expresadas en SQL — y por eso el resultado se vuelve a pasar por el dominio
    // más abajo: si alguna vez divergieran, gana el dominio.
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "Recommendation"
      WHERE "organizationId" = ${params.organizationId}
        AND cardinality("effectiveCollectionScope") > 0
        AND "effectiveCollectionScope" <@ ${allowedCollectionIds}::text[]
        ${
          params.status
            ? Prisma.sql`AND "status"::text = ${params.status}`
            : Prisma.empty
        }
      ORDER BY "priority" DESC, "createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    if (ids.length === 0) return [];

    const recommendations = await this.prisma.recommendation.findMany({
      where: {
        id: { in: ids.map((row) => row.id) },
        // El filtro de organización se repite: la consulta anterior ya lo aplicó, y aun así
        // esta no debe poder devolver nada de otro tenant por su cuenta.
        organizationId: params.organizationId,
      },
      include: this.viewInclude,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    // Segunda pasada por el DOMINIO sobre la página ya acotada. No es redundancia inútil:
    // es lo que garantiza que la autorización siga teniendo un único criterio aunque el SQL
    // se toque en el futuro.
    return recommendations
      .filter(
        (recommendation) =>
          evaluateRecommendationAccess({
            effectiveCollectionScope: recommendation.effectiveCollectionScope,
            allowedCollectionIds,
          }).allowed,
      )
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
    const resolvedAt = new Date();

    // Transición CONDICIONAL y atómica: la condición `status: NEW` viaja dentro del propio
    // UPDATE, no en un `if` previo.
    //
    // Comprobar el estado y despues actualizar deja una ventana entre ambas operaciones: dos
    // personas que aceptan a la vez leen NEW las dos, las dos pasan la comprobación y la
    // segunda escritura pisa a la primera. El resultado seria una decision humana borrada en
    // silencio —justo lo que `resolvedById` existe para conservar— y un `resolvedAt` que no
    // corresponde a la persona registrada. Con la condición dentro del UPDATE, Postgres
    // serializa las dos escrituras y solo una encuentra la fila en NEW.
    const { count } = await this.prisma.recommendation.updateMany({
      where: {
        id: recommendation.id,
        // El filtro de organización se repite tambien aqui: `updateMany` no hereda el WHERE
        // de la lectura anterior.
        organizationId: params.organizationId,
        status: RecommendationStatus.NEW,
      },
      data: {
        status,
        resolvedById: params.userId,
        resolvedAt,
      },
    });

    if (count === 0) {
      // O ya estaba resuelta, o otra persona ganó la carrera. En ambos casos la decisión
      // vigente es la que está persistida, y se relee para explicarla con exactitud.
      const current = await this.prisma.recommendation.findFirst({
        where: {
          id: recommendation.id,
          organizationId: params.organizationId,
        },
        select: { status: true, resolvedAt: true },
      });

      throw new ConflictException(
        `La recomendación ya fue resuelta como ${current?.status ?? 'RESUELTA'}` +
          (current?.resolvedAt
            ? ` el ${current.resolvedAt.toISOString()}`
            : ''),
      );
    }

    // Traza de la transición: quién, cuándo, estado anterior y estado nuevo. El estado
    // anterior es demostrablemente NEW porque el UPDATE condicional solo dispara desde ahí.
    await this.prisma.auditLog.create({
      data: {
        organizationId: params.organizationId,
        actorId: params.userId,
        action:
          status === RecommendationStatus.ACCEPTED
            ? 'recommendation.accepted'
            : 'recommendation.dismissed',
        targetType: 'Recommendation',
        targetId: recommendation.id,
        metadata: {
          previousStatus: RecommendationStatus.NEW,
          newStatus: status,
          resolvedAt: resolvedAt.toISOString(),
          sourceInsightId: recommendation.sourceInsightId,
          // Se registra el alcance con el que se autorizó la decisión: sin él, auditar a
          // posteriori "quién podía ver esto" exigiría reconstruir las concesiones de
          // entonces, que pueden haber cambiado desde.
          effectiveCollectionScope: recommendation.effectiveCollectionScope,
          // Constancia explícita: la aceptación no dispara nada fuera del sistema.
          externalActionExecuted: false,
        },
      },
    });

    const updated = await this.prisma.recommendation.findFirstOrThrow({
      where: { id: recommendation.id, organizationId: params.organizationId },
      include: this.viewInclude,
    });

    this.logger.log(
      `Recomendación ${updated.id}: NEW → ${status} por el usuario ${params.userId} — ` +
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

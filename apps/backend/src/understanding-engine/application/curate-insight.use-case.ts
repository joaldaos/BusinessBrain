import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  InsightFeedbackType,
  InsightStatus,
  InsightType,
  RecommendationStatus,
  type Recommendation,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Curación humana y puente con el Principio de Evolución Asistida —
 * UNDERSTANDING_ENGINE_DESIGN.md §3.7, §11, §12. Subfase 3.5.
 */
@Injectable()
export class CurateInsightUseCase {
  private readonly logger = new Logger(CurateInsightUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra curación humana sobre un `Insight` (§3.7). Una vez registrada tiene PRIORIDAD
   * sobre cualquier recálculo automático posterior hasta que se revoca explícitamente.
   *
   * Un descarte lleva el `Insight` a `DISCARDED`, estado terminal: deja de recuperarse por
   * defecto, pero nunca se borra.
   */
  async curate(params: {
    organizationId: string;
    insightId: string;
    type: InsightFeedbackType;
    comment?: string;
    actorUserId: string;
  }): Promise<void> {
    const insight = await this.prisma.insight.findFirst({
      where: { id: params.insightId, organizationId: params.organizationId },
      select: { id: true },
    });
    if (!insight) throw new NotFoundException('Insight no encontrado');

    if (params.type === InsightFeedbackType.REVOCATION) {
      throw new Error(
        'Una revocación se registra con revokeCuration, que exige indicar qué entrada deja sin efecto',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.insightFeedback.create({
        data: {
          organizationId: params.organizationId,
          insightId: insight.id,
          type: params.type,
          comment: params.comment ?? null,
          actorUserId: params.actorUserId,
        },
      });

      if (params.type === InsightFeedbackType.DISMISSAL) {
        await tx.insight.update({
          where: { id: insight.id },
          data: { status: InsightStatus.DISCARDED },
        });
      }
    });
  }

  /**
   * Revoca una curación previa: el `Insight` vuelve al cálculo automático. NO borra el
   * registro anterior — crea uno nuevo que lo deja sin efecto, mismo principio de nunca
   * sobrescribir que rige todo el sistema (§3.7).
   */
  async revokeCuration(params: {
    organizationId: string;
    feedbackId: string;
    actorUserId: string;
    comment?: string;
  }): Promise<void> {
    const feedback = await this.prisma.insightFeedback.findFirst({
      where: { id: params.feedbackId, organizationId: params.organizationId },
      include: { insight: { select: { id: true, status: true } } },
    });
    if (!feedback) throw new NotFoundException('InsightFeedback no encontrado');

    await this.prisma.$transaction(async (tx) => {
      await tx.insightFeedback.create({
        data: {
          organizationId: params.organizationId,
          insightId: feedback.insightId,
          type: InsightFeedbackType.REVOCATION,
          comment: params.comment ?? null,
          revokesFeedbackId: feedback.id,
          actorUserId: params.actorUserId,
        },
      });

      // Revocar un descarte devuelve el Insight al flujo vivo; el recálculo decidirá si
      // sigue sosteniéndose.
      if (
        feedback.type === InsightFeedbackType.DISMISSAL &&
        feedback.insight.status === InsightStatus.DISCARDED
      ) {
        await tx.insight.update({
          where: { id: feedback.insightId },
          data: {
            status: InsightStatus.ACTIVE,
            // El reloj del decaimiento arranca ahora: no se castiga retroactivamente el
            // periodo en que estuvo descartado por decisión humana.
            confidenceComputedAt: new Date(),
          },
        });
      }
    });
  }

  /**
   * Crea una `Recommendation` a partir de un `Insight` que implica una acción concreta
   * (§11, §12, `EscalateInsightToRecommendation`).
   *
   * **Crear una `Recommendation` NUNCA ejecuta nada**: solo la registra en estado `NEW`
   * para revisión humana, coherente con "siempre propone, nunca modifica automáticamente".
   *
   * Propaga el alcance efectivo del `Insight` de origen: sin esa propagación este caso de
   * uso sería una vía de blanqueo de alcance — convertiría una conclusión sostenida por
   * evidencia restringida en una entidad de otro dominio sin ninguna acotación (§12).
   */
  async escalateToRecommendation(params: {
    organizationId: string;
    insightId: string;
    /** Los seis puntos que el Principio de Evolución Asistida exige (§3.2 del plan). */
    contract: {
      title: string;
      detected: string;
      justification: string;
      estimatedImpact: string;
      advantages: string;
      drawbacks: string;
      affectedAreas: string;
      /** NUNCA se omite: si no aplica, se declara explícitamente como tal. */
      migrationPlan: string;
    };
    priority?: number;
  }): Promise<Recommendation> {
    const insight = await this.prisma.insight.findFirst({
      where: { id: params.insightId, organizationId: params.organizationId },
      include: { objectiveLinks: true },
    });
    if (!insight) throw new NotFoundException('Insight no encontrado');

    if (insight.status !== InsightStatus.ACTIVE) {
      throw new Error(
        'Solo un Insight activo puede escalarse: una conclusión descartada, superada o ' +
          'expirada no sostiene una propuesta de acción',
      );
    }

    if (params.contract.migrationPlan.trim().length === 0) {
      // El plan de migración nunca se omite ni se deja en blanco: si no aplica, se declara
      // explícitamente como "no aplica" (§3.2 del plan de migración).
      throw new Error(
        'El plan de migración nunca se omite: si el cambio no requiere migración, ' +
          'declárelo explícitamente como "no aplica (sin impacto estructural)"',
      );
    }

    const effectiveCollectionScope = await this.effectiveScopeOf(
      params.organizationId,
      insight.transitiveEvidenceClosure,
    );

    const recommendation = await this.prisma.recommendation.create({
      data: {
        organizationId: params.organizationId,
        title: params.contract.title,
        description: params.contract.detected,
        detected: params.contract.detected,
        justification: params.contract.justification,
        estimatedImpact: params.contract.estimatedImpact,
        advantages: params.contract.advantages,
        drawbacks: params.contract.drawbacks,
        affectedAreas: params.contract.affectedAreas,
        migrationPlan: params.contract.migrationPlan,
        sourceInsightId: insight.id,
        effectiveCollectionScope,
        priority: params.priority ?? 0,
        // Estado NEW: registrada para revisión humana. No ejecuta absolutamente nada.
        status: RecommendationStatus.NEW,
      },
    });

    this.logger.log(
      `Insight ${insight.id} (${insight.type}) escalado a Recommendation ` +
        `${recommendation.id} en estado NEW — sin ejecutar ninguna acción`,
    );

    return recommendation;
  }

  /**
   * Un `Insight` de tipo `RISK`/`OPPORTUNITY` es el candidato natural a escalarse, porque
   * ya está anclado a un objetivo real (§8). Pero la escalada NO es automática por tipo
   * (§11): depende de si el hallazgo articula una acción concreta, y esa decisión no la
   * toma el sistema.
   */
  isEscalationCandidate(type: InsightType): boolean {
    return type === InsightType.RISK || type === InsightType.OPPORTUNITY;
  }

  private async effectiveScopeOf(
    organizationId: string,
    closure: unknown,
  ): Promise<string[]> {
    const refIds = Array.isArray(closure)
      ? (closure as { refId: string }[]).map((c) => c.refId)
      : [];
    if (refIds.length === 0) return [];

    const memberships = await this.prisma.knowledgeItemCollection.findMany({
      where: { knowledgeItem: { id: { in: refIds }, organizationId } },
      select: { knowledgeCollectionId: true },
    });

    return [...new Set(memberships.map((m) => m.knowledgeCollectionId))];
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  InsightFeedbackType,
  InsightStatus,
  InsightType,
  RecommendationStatus,
  type Recommendation,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import { InsightScopeService } from './insight-scope.service';
import {
  authorizesEscalation,
  resolveOwnCuration,
} from '../domain/belief-curation';

/**
 * Curación humana y puente con el Principio de Evolución Asistida —
 * UNDERSTANDING_ENGINE_DESIGN.md §3.7, §11, §12. Subfase 3.5.
 *
 * Desde la subfase 6.1 ambas operaciones exigen que el actor CUBRA el alcance efectivo del
 * `Insight`, no solo que pertenezca a su organización. Antes bastaba lo segundo porque nada
 * llegaba hasta aquí desde fuera; al exponerse por HTTP, ese filtro dejaba de ser suficiente:
 * la curación es pegajosa frente al recálculo (§3.7) y el escalado propaga el alcance a una
 * entidad nueva (§12), así que ambas son escrituras duraderas sobre comprensión que el actor
 * podría no tener derecho a leer.
 */
@Injectable()
export class CurateInsightUseCase {
  private readonly logger = new Logger(CurateInsightUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly insightScope: InsightScopeService,
    private readonly audit: AuditService,
  ) {}

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
      select: { id: true, transitiveEvidenceClosure: true },
    });
    if (!insight) throw new NotFoundException('Insight no encontrado');

    // El alcance ANTES de escribir: curar es una decisión con efecto duradero sobre la
    // confianza, no una lectura.
    await this.insightScope.assertActorCoversInsight({
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      insightId: insight.id,
      transitiveEvidenceClosure: insight.transitiveEvidenceClosure,
    });

    if (params.type === InsightFeedbackType.REVOCATION) {
      // Petición mal formada, no fallo del servidor: quien llama ha usado la operación
      // equivocada y puede corregirlo. Devolver 500 lo presentaría como una avería nuestra.
      throw new BadRequestException(
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

    // La curación tiene PRIORIDAD sobre el recálculo automático (§3.7): es una decisión
    // humana con efecto duradero sobre la confianza, no una opinión pasajera.
    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.actorUserId,
      action: AUDIT_ACTIONS.INSIGHT_CURATED,
      targetType: AUDIT_TARGET_TYPES.INSIGHT,
      targetId: insight.id,
      metadata: {
        curationType: params.type,
        comment: params.comment ?? null,
        discardsInsight: params.type === InsightFeedbackType.DISMISSAL,
      },
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
      include: {
        insight: {
          select: { id: true, status: true, transitiveEvidenceClosure: true },
        },
      },
    });
    if (!feedback) throw new NotFoundException('InsightFeedback no encontrado');

    // Revocar una curación devuelve el Insight al recálculo automático: es tan decisivo
    // como haberlo curado, y exige el mismo alcance.
    await this.insightScope.assertActorCoversInsight({
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      insightId: feedback.insight.id,
      transitiveEvidenceClosure: feedback.insight.transitiveEvidenceClosure,
    });

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

    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.actorUserId,
      action: AUDIT_ACTIONS.INSIGHT_CURATION_REVOKED,
      targetType: AUDIT_TARGET_TYPES.INSIGHT_FEEDBACK,
      targetId: feedback.id,
      metadata: {
        insightId: feedback.insightId,
        revokedCurationType: feedback.type,
        comment: params.comment ?? null,
        // Revocar un descarte devuelve el Insight al flujo vivo: es un cambio de estado,
        // no solo una anotación.
        restoredInsight:
          feedback.type === InsightFeedbackType.DISMISSAL &&
          feedback.insight.status === InsightStatus.DISCARDED,
      },
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
    /** Quién escala. Debe CUBRIR el alcance efectivo del Insight de origen (6.1). */
    actorUserId: string;
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
      include: { objectiveLinks: true, feedback: true },
    });
    if (!insight) throw new NotFoundException('Insight no encontrado');

    // Cobertura del actor ANTES de cualquier otra comprobación. Escalar propaga el alcance
    // a una entidad nueva redactada por esta persona; hacerlo sobre evidencia que no puede
    // leer sería blanquear el alcance por el lado de quien dispara, no por el del dato.
    // Se reutiliza el alcance ya calculado aquí para no proyectarlo dos veces.
    const effectiveCollectionScope =
      await this.insightScope.assertActorCoversInsight({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        insightId: insight.id,
        transitiveEvidenceClosure: insight.transitiveEvidenceClosure,
      });

    if (insight.status !== InsightStatus.ACTIVE) {
      // Conflicto con el ESTADO del recurso, no con la petición: la misma llamada sería
      // válida si el Insight siguiera activo. Es exactamente la semántica de 409.
      throw new ConflictException(
        'Solo un Insight activo puede escalarse: una conclusión descartada, superada o ' +
          'expirada no sostiene una propuesta de acción',
      );
    }

    if (params.contract.migrationPlan.trim().length === 0) {
      // El plan de migración nunca se omite ni se deja en blanco: si no aplica, se declara
      // explícitamente como "no aplica" (§3.2 del plan de migración).
      throw new BadRequestException(
        'El plan de migración nunca se omite: si el cambio no requiere migración, ' +
          'declárelo explícitamente como "no aplica (sin impacto estructural)"',
      );
    }

    // Curación PROPIA de esta versión, obligatoria para escalar (7.1).
    //
    // Una curación HEREDADA de una versión anterior no sirve: dice que alguien validó una
    // afirmación distinta de la que ahora se propone convertir en acción. Escalar redacta el
    // contrato de Evolución Asistida sobre esta versión concreta, y §11 exige aprobación
    // explícita — tomar prestada la de otra afirmación sería fabricarla. Fail-closed: sin
    // curación propia no se escala.
    //
    // Se resuelve solo sobre el feedback de ESTA fila a propósito: no se recorre la cadena,
    // porque lo único que autoriza aquí es lo que se emitió sobre lo que se está escalando.
    const own = resolveOwnCuration(insight.feedback);
    const ownCuration = own
      ? {
          type: own.type,
          comment: own.comment,
          at: own.at,
          origin: 'OWN' as const,
          curatedVersionId: insight.id,
          disputed: false,
        }
      : null;

    if (!authorizesEscalation(ownCuration)) {
      throw new ConflictException(
        'Escalar exige curación humana explícita sobre esta versión del Insight. Si una ' +
          'persona validó una versión anterior, esa validación no se traslada: la ' +
          'afirmación ha cambiado desde entonces y debe confirmarse de nuevo',
      );
    }

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

    // Escalar convierte comprensión en una propuesta formal con el contrato de Evolución
    // Asistida. No ejecuta nada, y la traza lo deja explícito.
    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.actorUserId,
      action: AUDIT_ACTIONS.INSIGHT_ESCALATED,
      targetType: AUDIT_TARGET_TYPES.INSIGHT,
      targetId: insight.id,
      metadata: {
        recommendationId: recommendation.id,
        insightType: insight.type,
        effectiveCollectionScope,
        externalActionExecuted: false,
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
}

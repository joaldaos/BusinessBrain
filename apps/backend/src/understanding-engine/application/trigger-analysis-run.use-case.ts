import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AnalysisRunStatus,
  AnalysisRunTrigger,
  InsightStatus,
  InsightType,
  Prisma,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import {
  KNOWLEDGE_SIGNALS_PORT,
  type KnowledgeSignalsPort,
} from '../domain/ports/knowledge-signals.port';
import type {
  InsightCandidate,
  ReasoningStrategyPort,
} from '../domain/ports/reasoning-strategy.port';
import { KnowledgeSignalStrategy } from '../infrastructure/strategies/knowledge-signal.strategy';
import { BusinessObjectiveService } from './business-objective.service';
import { GenerativeSynthesisStrategy } from '../infrastructure/strategies/generative-synthesis.strategy';
import { applyRiskOpportunityGate } from '../domain/risk-opportunity-gate';
import {
  resolveInsightConflict,
  type ConflictParty,
} from '../domain/resolve-insight-conflict';

/**
 * Ejecuta un ciclo completo de razonamiento — UNDERSTANDING_ENGINE_DESIGN.md §4, §12.
 *
 * Subfase 3.1: una única estrategia simbólica sobre las señales del Knowledge Engine.
 * `ApplyRiskOpportunityGate` y `ResolveInsightConflict` llegan en 3.2 y 3.4; aquí el
 * pipeline es Disparador → AnalysisRun → estrategia → composición de confianza →
 * persistencia idempotente → cierre.
 *
 * VARIOS AnalysisRun simultáneos por organización son legítimos y NO se serializan (§3.1):
 * la corrección bajo concurrencia la garantiza la restricción de unicidad sobre
 * (organizationId, subjectIdentity) entre estados no terminales, no un bloqueo.
 */

export interface TriggerAnalysisRunParams {
  organizationId: string;
  trigger?: AnalysisRunTrigger;
  /** Acota las señales a las observadas desde este instante. */
  since?: Date;
}

export interface AnalysisRunResult {
  analysisRunId: string;
  status: AnalysisRunStatus;
  candidatesGenerated: number;
  insightsCreated: number;
  /** Candidatos cuyo sujeto ya tenía un `Insight` activo: reconocidos, no duplicados ni fallidos. */
  insightsAlreadyKnown: number;
}

@Injectable()
export class TriggerAnalysisRunUseCase {
  private readonly logger = new Logger(TriggerAnalysisRunUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(KNOWLEDGE_SIGNALS_PORT)
    private readonly knowledgeSignals: KnowledgeSignalsPort,
    private readonly signalStrategy: KnowledgeSignalStrategy,
    private readonly businessObjectives: BusinessObjectiveService,
    private readonly generativeStrategy: GenerativeSynthesisStrategy,
  ) {}

  async execute(params: TriggerAnalysisRunParams): Promise<AnalysisRunResult> {
    const run = await this.prisma.analysisRun.create({
      data: {
        organizationId: params.organizationId,
        trigger: params.trigger ?? AnalysisRunTrigger.MANUAL,
        status: AnalysisRunStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    try {
      const signals = await this.knowledgeSignals.listSignals({
        organizationId: params.organizationId,
        since: params.since,
      });

      // Cada candidato conserva la estrategia que lo generó: su fiabilidad base entra en
      // la composición de confianza (§9), y una conclusión generada no puede pesar lo
      // mismo que un hecho verificado.
      const strategies: ReasoningStrategyPort[] = [
        this.signalStrategy,
        this.generativeStrategy,
      ];
      const candidates: {
        candidate: InsightCandidate;
        strategy: ReasoningStrategyPort;
      }[] = [];

      for (const strategy of strategies) {
        const produced = await strategy.generate({
          organizationId: params.organizationId,
          signals,
        });
        candidates.push(
          ...produced.map((candidate) => ({ candidate, strategy })),
        );
      }

      // Objetivos que pueden anclar un juicio de valor: CONFIRMADOS y vigentes (§3.6).
      // Se resuelven una vez por ejecución, no por candidato.
      const confirmedObjectives =
        await this.businessObjectives.listConfirmedAndCurrent(
          params.organizationId,
        );

      let created = 0;
      let alreadyKnown = 0;

      for (const { candidate, strategy } of candidates) {
        const persisted = await this.persistCandidate({
          organizationId: params.organizationId,
          analysisRunId: run.id,
          candidate,
          strategy,
          confirmedObjectiveIds: confirmedObjectives.map((o) => o.id),
        });
        if (persisted) created += 1;
        else alreadyKnown += 1;
      }

      const result = await this.prisma.analysisRun.update({
        where: { id: run.id },
        data: {
          status: AnalysisRunStatus.SUCCESS,
          candidatesGenerated: candidates.length,
          insightsCreated: created,
          completedAt: new Date(),
        },
      });

      this.logger.log(
        `AnalysisRun ${run.id} (org ${params.organizationId}): ${signals.length} señales, ` +
          `${candidates.length} candidatos, ${created} Insight creados, ${alreadyKnown} ya conocidos`,
      );

      return {
        analysisRunId: result.id,
        status: result.status,
        candidatesGenerated: candidates.length,
        insightsCreated: created,
        insightsAlreadyKnown: alreadyKnown,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.analysisRun.update({
        where: { id: run.id },
        data: {
          status: AnalysisRunStatus.FAILED,
          error: message,
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  /**
   * Persiste un candidato como `Insight` activo, o lo reconoce como ya conocido.
   *
   * La restricción de unicidad parcial sobre (organizationId, subjectIdentity) limitada a
   * `ACTIVE` resuelve la concurrencia de forma DETERMINISTA y sin bloqueos (§12): si dos
   * `AnalysisRun` simultáneos producen el mismo sujeto, uno persiste y el otro reconoce el
   * conflicto — sin que eso cuente como fallo de su ejecución. El resultado es idéntico al
   * de procesarlos en cualquier orden secuencial.
   *
   * @returns `true` si creó el `Insight`, `false` si el sujeto ya estaba activo.
   */
  private async persistCandidate(params: {
    organizationId: string;
    analysisRunId: string;
    candidate: InsightCandidate;
    strategy: ReasoningStrategyPort;
    confirmedObjectiveIds: string[];
  }): Promise<boolean> {
    const { candidate, strategy } = params;

    // Gate de Riesgo/Oportunidad (§8): se aplica en el PIPELINE, nunca como convención de
    // las estrategias — ninguna, presente o futura, puede saltárselo.
    const gate = applyRiskOpportunityGate({
      type: candidate.type,
      degradesTo: candidate.degradesTo,
      confirmedObjectiveIds: params.confirmedObjectiveIds,
    });

    // Confianza compuesta (§9): mín(confianza de la evidencia) × fiabilidad de la
    // estrategia. Un Insight nunca puede valer más que su fuente más débil ni más de lo
    // que su propio mecanismo de generación merece.
    const confidence = Number(
      (candidate.rawConfidence * strategy.baseReliability).toFixed(4),
    );

    // Cierre transitivo de la evidencia (§3.4): inmutable, materializable. En 3.1 no hay
    // evidencia derivada todavía, luego coincide con la evidencia directa.
    const transitiveEvidenceClosure = candidate.evidence.map((e) => ({
      kind: e.kind,
      refId: e.refId,
    }));

    try {
      await this.prisma.$transaction(async (tx) => {
        const insight = await tx.insight.create({
          data: {
            organizationId: params.organizationId,
            analysisRunId: params.analysisRunId,
            subjectIdentity: candidate.subjectIdentity,
            type: gate.resolvedType,
            summary: candidate.summary,
            status: InsightStatus.ACTIVE,
            strategyKey: strategy.key,
            strategyVersion: strategy.version,
            reasoningTrace: {
              ...candidate.reasoningTrace,
              // La decisión del gate forma parte de la traza: si el candidato se degradó,
              // debe poder explicarse por qué (§10).
              riskOpportunityGate: {
                proposedType: candidate.type,
                resolvedType: gate.resolvedType,
                degraded: gate.degraded,
                rationale: gate.rationale,
              },
            },
            confidence,
            transitiveEvidenceClosure: transitiveEvidenceClosure,
          },
        });

        // Ancla de negocio (§3.8): relación propia, JAMÁS una pieza más de evidencia.
        for (const objectiveId of gate.objectiveIdsToLink) {
          await tx.insightObjectiveLink.create({
            data: { insightId: insight.id, businessObjectiveId: objectiveId },
          });
        }

        for (const evidence of candidate.evidence) {
          await tx.insightEvidence.create({
            data: {
              insightId: insight.id,
              kind: evidence.kind,
              role: evidence.role,
              // La referencia se guarda en la columna que corresponde a su naturaleza; la
              // restricción CHECK del esquema impide cualquier combinación incoherente.
              ...(evidence.kind === 'KNOWLEDGE_ITEM'
                ? { knowledgeItemId: evidence.refId }
                : {}),
              ...(evidence.kind === 'KNOWLEDGE_CHUNK'
                ? { knowledgeChunkId: evidence.refId }
                : {}),
              ...(evidence.kind === 'DERIVED_INSIGHT'
                ? { derivedInsightId: evidence.refId }
                : {}),
            },
          });
        }
      });

      return true;
    } catch (error) {
      if (this.isSubjectUniquenessViolation(error)) {
        // El asunto ya está representado por un Insight activo: otra estrategia, u otro
        // AnalysisRun concurrente, ganó su creación. No es un fallo — se reconcilian ambas
        // afirmaciones (§12, `ResolveInsightConflict`).
        await this.reconcileWithExisting({
          organizationId: params.organizationId,
          candidate,
          strategy,
          resolvedType: gate.resolvedType,
          confidence,
        });
        return false;
      }
      throw error;
    }
  }

  /**
   * `ResolveInsightConflict` (§12): reconcilia un candidato con el `Insight` activo que ya
   * representa su mismo asunto.
   *
   * Aplica la regla de independencia de §9 antes de tratar dos afirmaciones como
   * corroboración: dos cadenas que comparten evidencia dependen de la misma fuente y no
   * pueden "lavar" su confianza por convergencia aparente. Una contradicción, en cambio,
   * nunca se ignora en silencio — baja la confianza y queda registrada en la traza.
   *
   * La reconciliación no falla nunca la ejecución: si algo va mal aquí, el `Insight`
   * existente conserva su estado y el `AnalysisRun` continúa.
   */
  private async reconcileWithExisting(params: {
    organizationId: string;
    candidate: InsightCandidate;
    strategy: ReasoningStrategyPort;
    resolvedType: InsightType;
    confidence: number;
  }): Promise<void> {
    const existing = await this.prisma.insight.findFirst({
      where: {
        organizationId: params.organizationId,
        subjectIdentity: params.candidate.subjectIdentity,
        status: InsightStatus.ACTIVE,
      },
      select: {
        id: true,
        type: true,
        confidence: true,
        strategyKey: true,
        reasoningTrace: true,
        transitiveEvidenceClosure: true,
      },
    });
    if (!existing) return;

    const existingParty: ConflictParty = {
      type: existing.type,
      confidence: existing.confidence,
      strategyKey: existing.strategyKey,
      evidenceRefIds: this.closureRefIds(existing.transitiveEvidenceClosure),
    };
    const incomingParty: ConflictParty = {
      type: params.resolvedType,
      confidence: params.confidence,
      strategyKey: params.strategy.key,
      evidenceRefIds: params.candidate.evidence.map((e) => e.refId),
    };

    const resolution = resolveInsightConflict(existingParty, incomingParty);

    if (resolution.outcome === 'NOT_INDEPENDENT') {
      // Nada que registrar: reconocer el asunto como ya conocido no cambia lo que sabemos.
      return;
    }

    const previousTrace = (existing.reasoningTrace ?? {}) as Record<
      string,
      unknown
    >;
    const history = Array.isArray(previousTrace.reconciliations)
      ? (previousTrace.reconciliations as unknown[])
      : [];

    await this.prisma.insight.update({
      where: { id: existing.id },
      data: {
        confidence: resolution.resolvedConfidence,
        // La reconciliación forma parte de la traza: por qué cambió la confianza debe
        // poder explicarse igual que cualquier otra decisión (§10).
        reasoningTrace: {
          ...previousTrace,
          reconciliations: [
            ...history,
            {
              outcome: resolution.outcome,
              withStrategy: params.strategy.key,
              previousConfidence: existing.confidence,
              resolvedConfidence: resolution.resolvedConfidence,
              sharedEvidenceRefIds: resolution.sharedEvidenceRefIds,
              rationale: resolution.rationale,
              at: new Date().toISOString(),
            },
          ],
        } as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `Reconciliación sobre "${params.candidate.subjectIdentity}": ${resolution.outcome} — ` +
        `${resolution.rationale}`,
    );
  }

  private closureRefIds(closure: Prisma.JsonValue): string[] {
    return Array.isArray(closure)
      ? (closure as unknown as { refId: string }[]).map((c) => c.refId)
      : [];
  }

  /**
   * Dentro de `persistCandidate` la única restricción única que puede violarse es el índice
   * parcial `Insight_org_subject_active_key` — el `id` es un cuid generado, sin colisión
   * posible. Basta con reconocer el código de Prisma sin depender de que sepa mapear el
   * nombre de un índice parcial creado por SQL manual, mismo criterio ya usado en la
   * ingesta del Knowledge Engine.
   */
  private isSubjectUniquenessViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}

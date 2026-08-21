import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AnalysisRunStatus,
  AnalysisRunTrigger,
  InsightStatus,
  InsightType,
  Prisma,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
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
import { SubjectIdentityService } from './subject-identity.service';
import { ProposeFromInsightsUseCase } from './propose-from-insights.use-case';
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
  /** Quién lo lanzó, si fue una persona. Un disparo automático futuro no tendrá actor. */
  actorUserId?: string;
  /**
   * Fila de `AnalysisRun` ya reclamada por una superficie con control operativo propio (6.1).
   *
   * Omitirlo es el camino normal y conserva la concurrencia sin restricciones del §3.1. NO es
   * un mecanismo de exclusión: es la forma de que un control operativo externo —el disparo
   * manual por HTTP— pueda reservar su ejecución sin que el dominio adquiera un invariante de
   * serialización que la arquitectura congelada rechaza explícitamente (§20, tabla de
   * alternativas).
   */
  existingRunId?: string;
}

export interface AnalysisRunResult {
  analysisRunId: string;
  status: AnalysisRunStatus;
  candidatesGenerated: number;
  insightsCreated: number;
  /** Candidatos cuyo sujeto ya tenía un `Insight` activo: reconocidos, no duplicados ni fallidos. */
  insightsAlreadyKnown: number;
  /**
   * Propuestas creadas a partir de las conclusiones vivas, en estado pendiente.
   *
   * Es lo que convierte el análisis en algo que una PYME entiende: no solo "he comprendido",
   * sino "y esto es lo que creo que deberías mirar". Ninguna ejecuta nada.
   */
  recommendationsProposed: number;
}

/**
 * Otra reconciliación creó ya la sucesora de este asunto. No es un fallo del análisis: la
 * cadena tiene exactamente una sucesora y eso es lo correcto.
 */
class SupersessionRaceLostError extends Error {
  constructor(readonly supersededId: string) {
    super(`La versión ${supersededId} ya fue superada por otra reconciliación`);
    this.name = 'SupersessionRaceLostError';
  }
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
    private readonly audit: AuditService,
    private readonly subjectIdentity: SubjectIdentityService,
    private readonly proposeFromInsights: ProposeFromInsightsUseCase,
  ) {}

  /**
   * Abre la ejecución. **Sin bloqueo y sin serializar por organización** (§3.1, §12).
   *
   * Varios `AnalysisRun` simultáneos sobre la misma organización son legítimos y son el modo
   * NORMAL de operación: el barrido periódico y el disparo por evento se solapan por diseño.
   * La corrección bajo concurrencia no la da un cerrojo, la dan la unicidad de identidad de
   * sujeto por exclusión de estados terminales y `ResolveInsightConflict` — serializar aquí
   * pondría todo el análisis por evento detrás de una estrategia generativa lenta (bloqueo de
   * cabecera de línea), justo en el escenario de agentes autónomos de alta frecuencia.
   *
   * `existingRunId` permite ADOPTAR una fila ya reclamada por una superficie que aplique su
   * propio control operativo (hoy, el disparo manual por HTTP). Es opcional a propósito:
   * cualquier disparo automático —planificador, evento, agente— lo omite y conserva la
   * concurrencia intacta.
   */
  private async startRun(
    params: TriggerAnalysisRunParams,
  ): Promise<{ id: string }> {
    if (params.existingRunId) {
      return this.prisma.analysisRun.update({
        where: { id: params.existingRunId },
        data: {
          status: AnalysisRunStatus.RUNNING,
          startedAt: new Date(),
        },
        select: { id: true },
      });
    }

    return this.prisma.analysisRun.create({
      data: {
        organizationId: params.organizationId,
        trigger: params.trigger ?? AnalysisRunTrigger.MANUAL,
        status: AnalysisRunStatus.RUNNING,
        startedAt: new Date(),
      },
      select: { id: true },
    });
  }

  async execute(params: TriggerAnalysisRunParams): Promise<AnalysisRunResult> {
    const run = await this.startRun(params);

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
        // El DOMINIO resuelve la identidad; la estrategia solo la propuso (§13, 7.2). Toda
        // propuesta inválida, de un referente inexistente o de otra organización acaba en un
        // sujeto nuevo, jamás aproximada a uno existente (§3.4).
        const subject = await this.subjectIdentity.resolve({
          organizationId: params.organizationId,
          proposal: candidate.subjectProposal,
        });

        const persisted = await this.persistCandidate({
          organizationId: params.organizationId,
          analysisRunId: run.id,
          candidate,
          subjectIdentity: subject.value,
          strategy,
          confirmedObjectiveIds: confirmedObjectives.map((o) => o.id),
        });
        if (persisted) created += 1;
        else alreadyKnown += 1;
      }

      // Proponer va DESPUÉS de que las conclusiones estén persistidas: una propuesta se apoya
      // en comprensión ya asentada, no en candidatos a medio escribir. Y no puede tumbar el
      // análisis — lo que ya se comprendió sigue siendo válido aunque hoy no haya propuestas.
      let recommendationsProposed = 0;
      try {
        recommendationsProposed = await this.proposeFromInsights.execute({
          organizationId: params.organizationId,
          analysisRunId: run.id,
        });
      } catch (error) {
        this.logger.warn(
          `AnalysisRun ${run.id}: no se pudieron redactar propuestas (${(error as Error).message}). ` +
            `Las conclusiones creadas siguen siendo válidas`,
        );
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

      // Un análisis razona sobre TODO el conocimiento de la organización y gasta la clave
      // del cliente: quién lo lanzó y qué produjo es información de gobierno.
      await this.audit.record({
        organizationId: params.organizationId,
        actorId: params.actorUserId ?? null,
        action: AUDIT_ACTIONS.ANALYSIS_RUN_TRIGGERED,
        targetType: AUDIT_TARGET_TYPES.ANALYSIS_RUN,
        targetId: run.id,
        metadata: {
          trigger: params.trigger ?? AnalysisRunTrigger.MANUAL,
          status: AnalysisRunStatus.SUCCESS,
          signals: signals.length,
          candidatesGenerated: candidates.length,
          insightsCreated: created,
          insightsAlreadyKnown: alreadyKnown,
          recommendationsProposed,
          // Proponer no es ejecutar: se declara en la traza del propio análisis.
          externalActionExecuted: false,
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
        recommendationsProposed,
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

      // Un análisis fallido también es un hecho de gobierno: sin él, la traza contaría solo
      // los éxitos y nadie sabría que la organización lleva días sin comprender nada nuevo.
      await this.audit.record({
        organizationId: params.organizationId,
        actorId: params.actorUserId ?? null,
        action: AUDIT_ACTIONS.ANALYSIS_RUN_TRIGGERED,
        targetType: AUDIT_TARGET_TYPES.ANALYSIS_RUN,
        targetId: run.id,
        metadata: {
          trigger: params.trigger ?? AnalysisRunTrigger.MANUAL,
          status: AnalysisRunStatus.FAILED,
          error: message,
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
    /** Ya resuelta por el dominio. La estrategia no la acuña (§13). */
    subjectIdentity: string;
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
            subjectIdentity: params.subjectIdentity,
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
          analysisRunId: params.analysisRunId,
          candidate,
          subjectIdentity: params.subjectIdentity,
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
    /** Ejecución que produjo la versión sucesora: es su ancla temporal (Fase 7). */
    analysisRunId: string;
    candidate: InsightCandidate;
    subjectIdentity: string;
    strategy: ReasoningStrategyPort;
    resolvedType: InsightType;
    confidence: number;
  }): Promise<void> {
    const existing = await this.prisma.insight.findFirst({
      where: {
        organizationId: params.organizationId,
        subjectIdentity: params.subjectIdentity,
        status: InsightStatus.ACTIVE,
      },
      select: {
        id: true,
        type: true,
        confidence: true,
        strategyKey: true,
        strategyVersion: true,
        summary: true,
        subjectIdentity: true,
        reasoningTrace: true,
        transitiveEvidenceClosure: true,
        objectiveLinks: { select: { businessObjectiveId: true } },
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

    // VERSIÓN SUCESORA, nunca sobrescritura (§121, §344). El diseño congelado es explícito:
    // "nunca se sobrescribe en sitio". Hasta la Fase 7 esto era un `update` que machacaba la
    // confianza anterior, de modo que la trayectoria de una creencia se perdía en cada
    // reanálisis y "qué creíamos antes" era irrespondible.
    //
    // La versión anterior pasa a SUPERADO —estado terminal (§5)— y por eso libera el hueco
    // del índice único parcial sobre (organización, identidad de sujeto), que está definido
    // por exclusión de terminales (§370). Todo en UNA transacción: una cadena con dos
    // versiones vivas del mismo asunto, o con la anterior superada sin sucesora, serían
    // estados imposibles.
    let successorId: string;
    try {
      successorId = await this.createSuccessorVersion({
        existing,
        params,
        resolution,
        previousTrace,
      });
    } catch (error) {
      if (error instanceof SupersessionRaceLostError) {
        // Otra reconciliación concurrente ya versionó este asunto. La cadena queda con una
        // sola sucesora, que es la garantía que importa. No es un fallo de la ejecución.
        this.logger.warn(
          `Reconciliación sobre "${params.subjectIdentity}": ${error.message}`,
        );
        return;
      }
      throw error;
    }

    // La creencia cambió: queda traza. Sin actor porque no lo provocó una persona sino un
    // reanálisis; `AuditService` admite acciones de sistema (6.2).
    await this.audit.record({
      organizationId: params.organizationId,
      action: AUDIT_ACTIONS.INSIGHT_VERSIONED,
      targetType: AUDIT_TARGET_TYPES.INSIGHT,
      targetId: successorId,
      metadata: {
        subjectIdentity: params.subjectIdentity,
        supersededInsightId: existing.id,
        outcome: resolution.outcome,
        previousConfidence: existing.confidence,
        newConfidence: resolution.resolvedConfidence,
        analysisRunId: params.analysisRunId,
        withStrategy: params.strategy.key,
      },
    });

    this.logger.log(
      `Reconciliación sobre "${params.subjectIdentity}": ${resolution.outcome} — ` +
        `${resolution.rationale}. Versión ${existing.id} → ${successorId}`,
    );
  }

  /**
   * Crea la versión sucesora y marca la anterior como SUPERADO, atómicamente.
   *
   * El cierre transitivo de la sucesora es la UNIÓN del cierre anterior y la evidencia
   * entrante (§152, construcción incremental). Esa unión es lo que hace respondible "qué
   * evidencia entró": comparar los dos cierres da la atribución exacta sin recorrer el grafo
   * (§185).
   *
   * La evidencia de la versión anterior QUEDA CON ELLA como registro histórico (§188): no se
   * mueve ni se copia. La sucesora crea sus propias filas de `InsightEvidence`, inmutables
   * igual que las de su predecesora.
   *
   * Los anclajes a `BusinessObjective` se heredan: el asunto sigue importando por el mismo
   * motivo, y perderlos degradaría un RISK a un hallazgo sin ancla (§8).
   */
  private async createSuccessorVersion(params: {
    existing: {
      id: string;
      type: InsightType;
      confidence: number;
      strategyKey: string;
      strategyVersion: string;
      summary: string;
      subjectIdentity: string;
      transitiveEvidenceClosure: Prisma.JsonValue;
      objectiveLinks: { businessObjectiveId: string }[];
    };
    params: {
      organizationId: string;
      analysisRunId: string;
      candidate: InsightCandidate;
      strategy: ReasoningStrategyPort;
      resolvedType: InsightType;
    };
    resolution: {
      outcome: string;
      resolvedConfidence: number;
      sharedEvidenceRefIds: string[];
      rationale: string;
    };
    previousTrace: Record<string, unknown>;
  }): Promise<string> {
    const { existing, resolution, previousTrace } = params;
    const candidate = params.params.candidate;

    // Unión de cierres: el anterior más la evidencia entrante, sin duplicados. El cierre es
    // inmutable por versión (§150); lo que cambia entre versiones es lo que se compara.
    const previousClosure = this.closureEntries(
      existing.transitiveEvidenceClosure,
    );
    const seen = new Set(previousClosure.map((entry) => entry.refId));
    const mergedClosure = [...previousClosure];
    for (const evidence of candidate.evidence) {
      if (seen.has(evidence.refId)) continue;
      seen.add(evidence.refId);
      mergedClosure.push({ kind: evidence.kind, refId: evidence.refId });
    }

    const history = Array.isArray(previousTrace.reconciliations)
      ? (previousTrace.reconciliations as unknown[])
      : [];

    return this.prisma.$transaction(async (tx) => {
      // La anterior pasa a terminal ANTES de insertar: es lo que libera el hueco del índice
      // único. Condicionada a seguir ACTIVE, de modo que dos reconciliaciones simultáneas no
      // puedan producir dos sucesoras (bifurcación).
      const superseded = await tx.insight.updateMany({
        where: { id: existing.id, status: InsightStatus.ACTIVE },
        data: { status: InsightStatus.SUPERSEDED },
      });
      if (superseded.count === 0) {
        // Otra reconciliación ganó la carrera. No es un fallo: el asunto ya tiene sucesora y
        // volver a crear otra bifurcaría la cadena.
        throw new SupersessionRaceLostError(existing.id);
      }

      const successor = await tx.insight.create({
        data: {
          organizationId: params.params.organizationId,
          analysisRunId: params.params.analysisRunId,
          subjectIdentity: existing.subjectIdentity,
          type: params.params.resolvedType,
          summary: candidate.summary,
          status: InsightStatus.ACTIVE,
          strategyKey: params.params.strategy.key,
          strategyVersion: params.params.strategy.version,
          confidence: resolution.resolvedConfidence,
          transitiveEvidenceClosure: mergedClosure,
          // Enlace explícito con la versión que reemplaza: es el ÚNICO eje de orden de la
          // trayectoria, y es ortogonal al grafo de evidencia (§186).
          supersedesInsightId: existing.id,
          reasoningTrace: {
            ...previousTrace,
            reconciliations: [
              ...history,
              {
                outcome: resolution.outcome,
                withStrategy: params.params.strategy.key,
                previousConfidence: existing.confidence,
                resolvedConfidence: resolution.resolvedConfidence,
                sharedEvidenceRefIds: resolution.sharedEvidenceRefIds,
                rationale: resolution.rationale,
                supersededInsightId: existing.id,
                at: new Date().toISOString(),
              },
            ],
          } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      // El ancla de negocio se hereda: el asunto sigue importando por el mismo objetivo.
      for (const link of existing.objectiveLinks) {
        await tx.insightObjectiveLink.create({
          data: {
            insightId: successor.id,
            businessObjectiveId: link.businessObjectiveId,
          },
        });
      }

      // Evidencia PROPIA de la sucesora. La de la anterior no se toca (§188).
      for (const evidence of candidate.evidence) {
        await tx.insightEvidence.create({
          data: {
            insightId: successor.id,
            kind: evidence.kind,
            role: evidence.role,
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

      return successor.id;
    });
  }

  /** Entradas del cierre, tolerando un JSON que no sea una lista. */
  private closureEntries(
    raw: Prisma.JsonValue,
  ): { kind: string; refId: string }[] {
    return Array.isArray(raw)
      ? (raw as unknown as { kind: string; refId: string }[]).filter(
          (entry) => typeof entry?.refId === 'string',
        )
      : [];
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

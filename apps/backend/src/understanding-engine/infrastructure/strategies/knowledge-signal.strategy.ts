import { Injectable } from '@nestjs/common';
import { InsightType } from '@businessbrain/database';
import type {
  InsightCandidate,
  ReasoningContext,
  ReasoningStrategyPort,
} from '../../domain/ports/reasoning-strategy.port';
import type { KnowledgeSignal } from '../../domain/ports/knowledge-signals.port';

/**
 * Primera estrategia de razonamiento: SIMBÓLICA sobre las señales operativas del Knowledge
 * Engine — UNDERSTANDING_ENGINE_DESIGN.md §6, subfase 3.1.
 *
 * No invoca ningún modelo generativo: interpreta hechos objetivos que otro dominio ya
 * derivó y decide qué significan. Esa interpretación —qué constituye una anomalía y sobre
 * qué asunto— es epistemología, y por eso vive aquí y no en el Knowledge Engine.
 *
 * Produce únicamente `ANOMALY`: son observaciones sobre desviaciones respecto a un baseline
 * establecido (el umbral configurado, un grupo canónico sin resolver, una fuente que debía
 * estar conectada). Nunca `RISK` ni `OPPORTUNITY`: eso exigiría un `BusinessObjective`
 * confirmado, que no existe hasta la subfase 3.2 (§8).
 */
@Injectable()
export class KnowledgeSignalStrategy implements ReasoningStrategyPort {
  readonly key = 'knowledge-signal-interpretation';
  readonly version = '1.0.0';
  readonly kind = 'SYMBOLIC' as const;

  /**
   * Fiabilidad base alta: no hay ambigüedad de interpretación. La señal es un hecho
   * objetivo y la regla que la convierte en anomalía es determinista y auditable (§6).
   */
  readonly baseReliability = 0.9;

  readonly producibleTypes = [InsightType.ANOMALY];

  generate(context: ReasoningContext): Promise<InsightCandidate[]> {
    return Promise.resolve(
      context.signals
        .map((signal) => this.interpret(signal))
        .filter(
          (candidate): candidate is InsightCandidate => candidate !== null,
        ),
    );
  }

  /**
   * Los `facts` de una señal son datos objetivos de tipo abierto: convertirlos a texto sin
   * comprobar produciría "[object Object]" en un resumen que un humano va a leer.
   */
  private text(value: unknown, fallback: string): string {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : fallback;
  }

  private interpret(signal: KnowledgeSignal): InsightCandidate | null {
    switch (signal.kind) {
      case 'CONFIDENCE_DECAYED':
        return this.decayAnomaly(signal);
      case 'SOURCE_DISCONNECTED':
        return this.disconnectedSourceAnomaly(signal);
      case 'CANONICALIZATION_UNRESOLVED':
        return this.unresolvedConflictAnomaly(signal);
      default:
        // Una señal de un tipo que esta estrategia no sabe interpretar se ignora en
        // silencio: no inventa una conclusión sobre algo que no entiende.
        return null;
    }
  }

  private decayAnomaly(signal: KnowledgeSignal): InsightCandidate {
    const title = this.text(signal.facts.title, 'documento sin título');
    const score = Number(signal.facts.confidenceScore ?? 0);
    const floor = Number(signal.facts.floor ?? 0);

    return {
      // Identidad de sujeto (§3.4): describe el ASUNTO, no la evidencia concreta ni el
      // momento. Dos ejecuciones que observen el mismo decaimiento del mismo documento
      // producen la misma identidad, y por eso no duplican el Insight.
      subjectIdentity: `confidence-decay:knowledge-item:${signal.subjectId}`,
      type: InsightType.ANOMALY,
      summary:
        `La confianza de "${title}" cayó a ${score.toFixed(2)}, por debajo del umbral ` +
        `${floor.toFixed(2)} configurado por la organización. Dejó de ser recuperable por defecto.`,
      evidence: [
        {
          kind: 'KNOWLEDGE_ITEM',
          role: 'DEVIATION',
          refId: signal.subjectId,
        },
      ],
      // La señal es un hecho objetivo verificable, no una estimación.
      rawConfidence: 1,
      reasoningTrace: {
        strategyKind: 'SYMBOLIC',
        rule: 'confidenceScore <= minimumFloor',
        signalKind: signal.kind,
        observedAt: signal.observedAt.toISOString(),
        facts: signal.facts,
      },
    };
  }

  private disconnectedSourceAnomaly(signal: KnowledgeSignal): InsightCandidate {
    const name = this.text(signal.facts.name, 'fuente sin nombre');
    const affected = Number(signal.facts.affectedKnowledgeItems ?? 0);

    return {
      subjectIdentity: `source-disconnected:knowledge-source:${signal.subjectId}`,
      type: InsightType.ANOMALY,
      summary:
        `La fuente "${name}" está en estado ${this.text(signal.facts.status, 'desconocido')} y ha dejado de ` +
        `actualizar el conocimiento que originó (${affected} documento(s) afectados).`,
      evidence: [
        {
          kind: 'KNOWLEDGE_ITEM',
          role: 'DEVIATION',
          // La señal apunta a la KnowledgeSource; la evidencia trazable del Insight son
          // los documentos afectados, que se resuelven al persistir.
          refId: signal.subjectId,
        },
      ],
      rawConfidence: 1,
      reasoningTrace: {
        strategyKind: 'SYMBOLIC',
        rule: 'knowledgeSource.status IN (ERROR, DISABLED)',
        signalKind: signal.kind,
        observedAt: signal.observedAt.toISOString(),
        facts: signal.facts,
      },
    };
  }

  private unresolvedConflictAnomaly(signal: KnowledgeSignal): InsightCandidate {
    const count = Number(signal.facts.candidateCount ?? 0);

    return {
      subjectIdentity: `canonicalization-unresolved:canonical-entity:${signal.subjectId}`,
      type: InsightType.ANOMALY,
      summary:
        `${count} documentos describen el mismo hecho sin que el sistema pueda determinar ` +
        `cuál prevalece. El conflicto sigue abierto y espera revisión humana.`,
      evidence: [
        {
          kind: 'CANONICAL_ENTITY',
          role: 'CONTRADICTION',
          refId: signal.subjectId,
        },
      ],
      rawConfidence: 1,
      reasoningTrace: {
        strategyKind: 'SYMBOLIC',
        rule: 'canonicalKnowledgeEntity.status = IN_CONFLICT',
        signalKind: signal.kind,
        observedAt: signal.observedAt.toISOString(),
        facts: signal.facts,
      },
    };
  }
}

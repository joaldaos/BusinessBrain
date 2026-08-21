import { Injectable, Logger } from '@nestjs/common';
import {
  InsightStatus,
  RecommendationStatus,
  type Insight,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import { ProviderRegistry } from '../../llm/application/provider-registry.service';
import { InsightScopeService } from './insight-scope.service';
import {
  evaluateEligibility,
  isPublishableProposal,
  type ProposalDraft,
} from '../domain/recommendation-eligibility';

/**
 * De comprensión a PROPUESTA — el paso que convierte "te respondo cuando preguntas" en
 * "he detectado algo y te propongo qué hacer".
 *
 * ## Proponer no es aprobar, y desde luego no es ejecutar
 *
 * Lo que se crea aquí es una `Recommendation` en estado `NEW`: registrada para que una persona
 * la lea. **No ejecuta absolutamente nada** — ni correos, ni cambios de configuración, ni
 * llamadas a terceros, ni automatizaciones. La aprobación explícita que exige el Principio de
 * Evolución Asistida sigue existiendo: es aceptar o descartar, con actor y fecha.
 *
 * El camino manual —escalar un `Insight` redactando el contrato a mano— se mantiene intacto,
 * con su puerta de curación humana previa. Son dos vías distintas hacia la misma entidad, y se
 * distinguen por `createdById`: nulo cuando lo propuso el sistema.
 *
 * ## Cero propuestas antes que una falsa
 *
 * Dos puertas, y las dos cierran hacia fuera. Antes de gastar una llamada al modelo, la regla
 * de elegibilidad decide si la conclusión tiene material —evidencia, confianza, estado, tipo y
 * alcance—. Después, la respuesta del modelo tiene que traer los ocho apartados del contrato
 * completos; si viene a medias, se descarta y no se crea nada.
 *
 * Un proveedor caído tampoco produce propuestas a medias: se registra y el análisis termina
 * igualmente, porque las conclusiones que acaba de crear siguen siendo válidas.
 */
@Injectable()
export class ProposeFromInsightsUseCase {
  private readonly logger = new Logger(ProposeFromInsightsUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly insightScope: InsightScopeService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Revisa las conclusiones vivas de la organización y propone sobre las que lo merecen.
   *
   * @returns cuántas propuestas nuevas se crearon.
   */
  async execute(params: {
    organizationId: string;
    analysisRunId: string;
  }): Promise<number> {
    const insights = await this.prisma.insight.findMany({
      where: {
        organizationId: params.organizationId,
        status: InsightStatus.ACTIVE,
        // Solo lo que articula una acción. La regla lo vuelve a comprobar; aquí acota la
        // consulta para no traerse conclusiones que se van a descartar igualmente.
        type: { in: ['RISK', 'OPPORTUNITY', 'ANOMALY'] },
      },
      orderBy: { confidence: 'desc' },
      take: MAX_PROPOSALS_PER_RUN * 4,
    });

    let created = 0;
    for (const insight of insights) {
      if (created >= MAX_PROPOSALS_PER_RUN) break;
      if (await this.proposeFor(insight, params.analysisRunId)) created += 1;
    }

    return created;
  }

  private async proposeFor(
    insight: Insight,
    analysisRunId: string,
  ): Promise<boolean> {
    // El alcance sale de la MISMA proyección que usa todo lo demás: las colecciones de la
    // evidencia que sostiene la conclusión. No se copia ni se recalcula por otra vía, porque
    // dos criterios de alcance conviviendo es exactamente cómo se blanquea uno.
    const effectiveCollectionScope = await this.insightScope.effectiveScopeOf(
      insight.organizationId,
      insight.transitiveEvidenceClosure,
    );

    const alreadyProposed = await this.prisma.recommendation.count({
      where: {
        organizationId: insight.organizationId,
        sourceInsightId: insight.id,
        // Una descartada NO se vuelve a proponer: la persona ya dijo que no.
        status: {
          in: [
            RecommendationStatus.NEW,
            RecommendationStatus.ACCEPTED,
            RecommendationStatus.DISMISSED,
          ],
        },
      },
    });

    const decision = evaluateEligibility({
      status: insight.status,
      type: insight.type,
      confidence: insight.confidence,
      evidenceCount: evidenceCountOf(insight),
      effectiveCollectionScope,
      alreadyProposed: alreadyProposed > 0,
    });

    if (!decision.eligible) {
      this.logger.debug(
        `Insight ${insight.id} no genera propuesta: ${decision.reason ?? 'sin motivo'}`,
      );
      return false;
    }

    const draft = await this.draftProposal(insight, effectiveCollectionScope);
    if (!isPublishableProposal(draft)) {
      // El modelo no ha reunido material suficiente para los ocho apartados. Es preferible
      // no proponer nada: una propuesta a medias no cumple el contrato y no se puede evaluar.
      this.logger.log(
        `Insight ${insight.id}: sin material suficiente para una propuesta completa, no se ` +
          `crea ninguna`,
      );
      return false;
    }

    const recommendation = await this.prisma.recommendation.create({
      data: {
        organizationId: insight.organizationId,
        title: draft.title,
        description: draft.detected,
        detected: draft.detected,
        justification: draft.justification,
        estimatedImpact: draft.estimatedImpact,
        advantages: draft.advantages,
        drawbacks: draft.drawbacks,
        affectedAreas: draft.affectedAreas,
        migrationPlan: draft.migrationPlan,
        sourceInsightId: insight.id,
        effectiveCollectionScope,
        // Propuesta por BusinessBrain: sin autor humano. Es lo que permite distinguirla en la
        // pantalla de una que redactó una persona.
        createdById: null,
        status: RecommendationStatus.NEW,
      },
    });

    await this.audit.record({
      organizationId: insight.organizationId,
      // Sin actor: no lo provocó una persona, lo propuso el análisis.
      actorId: null,
      action: AUDIT_ACTIONS.RECOMMENDATION_PROPOSED,
      targetType: AUDIT_TARGET_TYPES.RECOMMENDATION,
      targetId: recommendation.id,
      metadata: {
        analysisRunId,
        sourceInsightId: insight.id,
        insightType: insight.type,
        confidence: insight.confidence,
        effectiveCollectionScope,
        // Se declara explícitamente en cada traza: proponer no ejecuta nada.
        externalActionExecuted: false,
      },
    });

    this.logger.log(
      `Insight ${insight.id} produjo la propuesta ${recommendation.id} en estado NEW — ` +
        `pendiente de decisión humana, sin ejecutar ninguna acción`,
    );

    return true;
  }

  /**
   * Le pide al modelo el contrato completo, con la evidencia delante.
   *
   * El prompt es deliberadamente restrictivo: se le dice que puede negarse. Un modelo al que
   * solo se le pide "propón algo" propone algo siempre, incluso cuando no hay nada que
   * proponer, y eso es justo lo que no queremos.
   */
  private async draftProposal(
    insight: Insight,
    scope: string[],
  ): Promise<Partial<ProposalDraft> | null> {
    let raw: string;
    try {
      const { profile, provider, apiKey } =
        await this.providerRegistry.resolveForOrganization(
          insight.organizationId,
        );

      const result = await provider.complete(
        {
          systemPrompt: PROPOSAL_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: promptFor(insight) }],
        },
        profile.modelName,
        apiKey,
      );
      raw = result.content;
    } catch (error) {
      // Un proveedor caído no invalida el análisis: las conclusiones que acaba de producir
      // siguen siendo válidas y consultables. Simplemente hoy no hay propuestas.
      this.logger.warn(
        `No se pudo redactar la propuesta del Insight ${insight.id}: ` +
          `${(error as Error).message}`,
      );
      return null;
    }

    void scope;
    return parseProposal(raw);
  }
}

/** Tope por ejecución: un análisis no puede enterrar a nadie bajo veinte propuestas. */
const MAX_PROPOSALS_PER_RUN = 3;

function evidenceCountOf(insight: Insight): number {
  const closure = insight.transitiveEvidenceClosure;
  return Array.isArray(closure) ? closure.length : 0;
}

const PROPOSAL_SYSTEM_PROMPT = `Eres el analista de negocio de una PYME. A partir de una conclusión ya verificada y de su evidencia, propones UNA acción concreta.

Reglas que no puedes saltarte:
- Si la conclusión no da para proponer una acción concreta y justificable, responde exactamente: SIN_PROPUESTA
- No inventes datos, cifras ni hechos que no estén en la conclusión.
- Escribe en castellano, en lenguaje de negocio, sin tecnicismos informáticos.
- No propongas nada que implique ejecutar algo automáticamente: propones a una persona que decidirá.

Responde SOLO con un objeto JSON con exactamente estas claves, todas rellenas con una o dos frases:
{"title","detected","justification","estimatedImpact","advantages","drawbacks","affectedAreas","migrationPlan"}

- title: la acción propuesta, en una línea.
- detected: qué ha detectado BusinessBrain.
- justification: por qué importa para el negocio.
- estimatedImpact: qué se espera conseguir.
- advantages: a favor.
- drawbacks: en contra o riesgos.
- affectedAreas: qué partes del negocio se ven afectadas.
- migrationPlan: primeros pasos para llevarlo a cabo. Si no requiere preparación, dilo explícitamente.`;

function promptFor(insight: Insight): string {
  return [
    `Conclusión (${insight.type}, confianza ${insight.confidence.toFixed(2)}):`,
    insight.summary,
    '',
    'Razonamiento que la sostiene:',
    JSON.stringify(insight.reasoningTrace),
  ].join('\n');
}

/**
 * Lee la respuesta del modelo.
 *
 * Tolera que venga envuelta en un bloque de código, porque los modelos lo hacen a menudo, y
 * devuelve `null` ante cualquier cosa que no sea el objeto esperado. No se intenta rescatar
 * una respuesta rota: lo que no se entiende no se publica.
 */
export function parseProposal(raw: string): Partial<ProposalDraft> | null {
  const text = raw.trim();
  if (text.includes('SIN_PROPUESTA')) return null;

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

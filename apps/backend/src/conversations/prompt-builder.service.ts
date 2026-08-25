import { Injectable } from '@nestjs/common';
import { MessageRole } from '@businessbrain/database';
import {
  GROUNDING_DIRECTIVE,
  type BuiltContext,
} from '../knowledge-engine/domain/context-builder';
import type {
  LlmCompletionRequest,
  LlmMessage,
} from '../llm/domain/ports/llm-provider.port';
import type { Locale } from '../common/i18n/locales';
import {
  answerLanguageDirective,
  noKnowledgeAnswerIn,
} from './domain/answer-language';

/**
 * Construcción del prompt del chat — BUSINESSBRAIN_MIGRATION_PLAN.md §7.2.
 *
 * Existe como unidad propia porque hay dos caminos que deben producir EXACTAMENTE el mismo
 * prompt: la respuesta síncrona y la respuesta en streaming. Si divergieran, la misma
 * pregunta daría respuestas distintas según cómo la pidiera el cliente.
 *
 * Es determinista y sin efectos: mismas entradas, mismo prompt. No decide qué conocimiento
 * ni qué comprensión entran — eso ya se resolvió aguas arriba.
 */

/** Cuántos turnos previos se incluyen. El historial compite por el mismo presupuesto (§14). */
export const HISTORY_TURNS = 10;

export interface PromptInsight {
  summary: string;
  confidence: number;
  freshness: string;
}

export interface PromptInput {
  question: string;
  context: BuiltContext;
  insights: PromptInsight[];
  history: { role: MessageRole; content: string }[];
  /**
   * En qué idioma se le responde a la persona.
   *
   * NO es el idioma de los documentos: son cosas independientes y el producto sería
   * inservible si exigiera que coincidieran. Ver `domain/answer-language.ts`.
   */
  locale: Locale;
}

@Injectable()
export class PromptBuilderService {
  /**
   * Sin conocimiento recuperado NI comprensión previa no hay nada sobre lo que responder.
   * Quien llama debe usar `noKnowledgeAnswer()` en vez de invocar al modelo: preguntarle
   * sin material es exactamente la situación en la que inventaría la respuesta.
   */
  hasMaterial(input: Pick<PromptInput, 'context' | 'insights'>): boolean {
    return input.context.pieces.length > 0 || input.insights.length > 0;
  }

  /**
   * La escribimos nosotros, no el modelo — a él no se le llega a llamar. Por eso es de las
   * pocas frases del backend que hay que tener escritas en cada idioma.
   */
  noKnowledgeAnswer(locale: Locale): string {
    return noKnowledgeAnswerIn(locale);
  }

  build(input: PromptInput): LlmCompletionRequest {
    return this.buildFrom(this.systemPrompt(input), input);
  }

  /**
   * Igual que `build`, pero con un system prompt ya compuesto aguas arriba — el caso de un
   * `Agent`, cuyo prompt lo arma `RunAgentUseCase` con su configuración, su memoria y sus
   * guardrails.
   *
   * El ensamblado de MENSAJES (historial + turno actual) es idéntico en ambos caminos, y lo
   * es a propósito: si divergiera, una conversación con agente y otra sin él tratarían el
   * historial de forma distinta sin que nada lo justifique.
   */
  buildFrom(systemPrompt: string, input: PromptInput): LlmCompletionRequest {
    return {
      systemPrompt,
      messages: this.messages(input),
      temperature: 0.2,
      maxTokens: 1500,
    };
  }

  private systemPrompt(input: PromptInput): string {
    return [
      'Eres el asistente de BusinessBrain. Respondes sobre el conocimiento interno de una empresa.',
      '',
      // Antes que nada: en qué idioma se contesta y qué no se puede tocar al citar. Va arriba
      // a propósito — es una regla sobre CÓMO se responde, no sobre qué se responde.
      answerLanguageDirective(input.locale),
      '',
      GROUNDING_DIRECTIVE,
      this.understandingBlock(input.insights),
      '',
      'Contexto recuperado:',
      input.context.text || '(sin fragmentos relevantes)',
    ].join('\n');
  }

  /**
   * Lo que la organización ya ha COMPRENDIDO, separado del conocimiento recuperado: son
   * conclusiones razonadas, no fragmentos. Cada una viaja con su confianza, y si no está
   * fresca se dice — una conclusión pendiente de revisión no puede presentarse como firme.
   */
  private understandingBlock(insights: PromptInsight[]): string {
    if (insights.length === 0) return '';

    return [
      '',
      'Lo que la organización ya ha comprendido sobre su actividad:',
      ...insights.map((insight) => {
        const stale =
          insight.freshness !== 'FRESH'
            ? `, ${insight.freshness.toLowerCase()}: pendiente de revisión`
            : '';
        return `- ${insight.summary} (confianza ${insight.confidence.toFixed(2)}${stale})`;
      }),
    ].join('\n');
  }

  private messages(input: PromptInput): LlmMessage[] {
    return [
      ...input.history.slice(-HISTORY_TURNS).map((message) => ({
        role:
          message.role === MessageRole.ASSISTANT
            ? ('assistant' as const)
            : ('user' as const),
        content: message.content,
      })),
      { role: 'user' as const, content: input.question },
    ];
  }
}

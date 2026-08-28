import { Injectable, Logger } from '@nestjs/common';
import { ProviderRegistry } from '../../llm/application/provider-registry.service';
import {
  parseTurn,
  toolDenialBlock,
  toolResultBlock,
} from '../domain/directives';
import { buildSystemPrompt } from '../domain/system-prompt';
import { TOOL_LIST, TOOL_OUTCOMES, type ToolOutcome } from '../domain/tools';
import { AssistantToolRunner } from './tool-runner.service';
import type { LlmMessage } from '../../llm/domain/ports/llm-provider.port';
import type { RequestUser } from '../../common/types/authenticated-request';

/**
 * El turno del asistente de operación: pregunta, consultas y respuesta.
 *
 * ## El bucle es del servidor, entero
 *
 * Quién pregunta, cuántas vueltas se dan, qué herramienta se ejecuta y con qué permisos: todo
 * lo decide este código. El modelo solo aporta texto — y su texto se trata como una PETICIÓN
 * que puede rechazarse, nunca como una orden.
 *
 * El identificador de quien pregunta viene del token (`RequestUser`), no de la conversación.
 * Es la diferencia que impide que una pregunta diga "actúa como el administrador Fulano": no
 * hay parámetro por el que ese identificador pueda entrar desde fuera.
 *
 * ## Tres vueltas como máximo
 *
 * Suficiente para encadenar «mira el panorama, luego mira esa empresa, luego responde», que es
 * el caso real más largo que tiene sentido. Sin tope, un modelo que pidiera herramienta en
 * cada vuelta consumiría llamadas al proveedor indefinidamente — y aquí el gasto es de
 * plataforma, sin presupuesto de cliente que lo frene.
 */
const MAX_TURNS = 3;

/** Tope de la respuesta. Una respuesta de operación no necesita más. */
const MAX_TOKENS = 1200;

export interface AssistantAnswer {
  /** Lo que lee la persona, ya sin directivas. */
  text: string;
  /**
   * Qué consultó, en orden, y cómo fue.
   *
   * Se devuelve SIEMPRE. Es lo que convierte una respuesta en algo comprobable: quien lee
   * puede ver de dónde salió cada dato, y si el asistente no consultó nada, también lo ve.
   */
  consulted: Array<{ tool: string; outcome: ToolOutcome }>;
}

@Injectable()
export class PlatformAssistantService {
  private readonly logger = new Logger(PlatformAssistantService.name);

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly tools: AssistantToolRunner,
  ) {}

  /**
   * Lo que el asistente puede consultar, para que la pantalla lo enseñe antes de preguntar.
   *
   * Sale del MISMO catálogo que ve el modelo. Una lista escrita a mano en la interfaz
   * acabaría prometiendo cosas que el asistente no puede hacer.
   */
  capabilities() {
    return TOOL_LIST.map((tool) => ({
      name: tool.name,
      purpose: tool.purpose,
      // Código estable, no frase: la interfaz decide cómo se dice.
      requires: tool.permission.kind === 'GRANT' ? tool.permission.scope : null,
    }));
  }

  async ask(params: {
    admin: RequestUser;
    question: string;
  }): Promise<AssistantAnswer> {
    const { profile, provider, apiKey } =
      await this.providers.resolveForPlatform();

    const systemPrompt = buildSystemPrompt({
      locale: params.admin.locale,
      adminName: params.admin.name,
    });

    const messages: LlmMessage[] = [{ role: 'user', content: params.question }];
    const consulted: AssistantAnswer['consulted'] = [];

    for (let vuelta = 0; vuelta < MAX_TURNS; vuelta += 1) {
      const respuesta = await provider.complete(
        { systemPrompt, messages, maxTokens: MAX_TOKENS },
        profile.modelName,
        apiKey,
      );

      const turno = parseTurn(respuesta.content);

      if (!turno.request) return { text: turno.text, consulted };

      const ejecucion = await this.tools.run({
        // De AQUÍ, no de la conversación. Es lo que hace imposible que una pregunta pida
        // actuar en nombre de otro administrador.
        adminId: params.admin.id,
        tool: turno.request.tool,
        input: turno.request.input,
      });

      consulted.push({ tool: ejecucion.tool, outcome: ejecucion.outcome });

      // Lo que el modelo dijo ANTES de pedir se conserva: a veces adelanta parte de la
      // respuesta, y descartarlo obligaría a repetirla.
      messages.push({ role: 'assistant', content: respuesta.content });
      messages.push({
        role: 'user',
        content:
          ejecucion.outcome === TOOL_OUTCOMES.OK
            ? toolResultBlock(ejecucion.tool, ejecucion.result)
            : toolDenialBlock(ejecucion.tool, ejecucion.outcome),
      });
    }

    // Se agotaron las vueltas pidiendo herramientas. Se le pide una respuesta final SIN
    // permitirle pedir más: quedarse callado sería lo peor de las dos opciones.
    const cierre = await provider.complete(
      {
        systemPrompt:
          systemPrompt +
          '\n\nYa no puedes consultar nada más. Responde con lo que tengas y di qué te faltó.',
        messages,
        maxTokens: MAX_TOKENS,
      },
      profile.modelName,
      apiKey,
    );

    return { text: parseTurn(cierre.content).text, consulted };
  }
}

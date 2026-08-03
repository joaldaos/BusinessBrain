import {
  defaultAgentConfiguration,
  parseAgentConfiguration,
  type AgentConfiguration,
} from './agent-configuration';
import {
  MAX_EXECUTABLE_PERMISSION,
  evaluateToolRequest,
  executableTools,
  guardrailDirective,
} from './agent-policy';

/**
 * Gate de políticas — §7.4.
 *
 * Lo que se prueba es qué se DENIEGA. Este gate es la única barrera real entre "el modelo
 * pidió una herramienta" y "la herramienta se ejecuta"; los guardrails textuales del prompt
 * son comportamiento, no control.
 */
describe('evaluateToolRequest', () => {
  const config = (
    overrides: Record<string, unknown> = {},
  ): AgentConfiguration =>
    parseAgentConfiguration({
      tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
      ...overrides,
    });

  const ask = (
    tool: string,
    overrides: {
      configuration?: AgentConfiguration;
      isActive?: boolean;
      toolCallsSoFar?: number;
    } = {},
  ) =>
    evaluateToolRequest({
      configuration: overrides.configuration ?? config(),
      isActive: overrides.isActive ?? true,
      tool,
      toolCallsSoFar: overrides.toolCallsSoFar ?? 0,
    });

  describe('falla cerrado', () => {
    it('deniega una herramienta que el agente no tiene concedida', () => {
      const decision = ask('sql_query');

      // Existir en la plataforma no es haber sido concedida a ESTE agente.
      expect(decision.allowed).toBe(false);
      expect(decision.allowed === false && decision.reason).toBe(
        'TOOL_NOT_GRANTED',
      );
    });

    it('deniega una herramienta inexistente sin tratarla distinto', () => {
      expect(ask('herramienta_inventada').allowed).toBe(false);
    });

    it('un agente sin herramientas declaradas no puede ejecutar ninguna', () => {
      expect(
        ask('knowledge_search', { configuration: defaultAgentConfiguration() })
          .allowed,
      ).toBe(false);
    });

    it('un agente desactivado no ejecuta nada, aunque su configuración sea válida', () => {
      const decision = ask('knowledge_search', { isActive: false });

      expect(decision.allowed).toBe(false);
      expect(decision.allowed === false && decision.reason).toBe(
        'AGENT_INACTIVE',
      );
    });
  });

  describe('la configuración concede como mucho, nunca amplía', () => {
    it('deniega AUTONOMOUS aunque el agente la declare', () => {
      const decision = ask('send_email', {
        configuration: config({
          tools: [{ tool: 'send_email', permission: 'AUTONOMOUS' }],
        }),
      });

      // Cierra por construcción la combinación datos privados + contenido no confiable +
      // acción externa: no existe camino de código que envíe el email.
      expect(decision.allowed).toBe(false);
      expect(decision.allowed === false && decision.reason).toBe(
        'PERMISSION_NOT_EXECUTABLE',
      );
    });

    it('deniega REQUIRES_CONFIRMATION en esta versión de la plataforma', () => {
      const decision = ask('send_email', {
        configuration: config({
          tools: [{ tool: 'send_email', permission: 'REQUIRES_CONFIRMATION' }],
        }),
      });

      expect(decision.allowed === false && decision.reason).toBe(
        'PERMISSION_NOT_EXECUTABLE',
      );
    });

    it('permite READ_ONLY, que es el máximo ejecutable hoy', () => {
      expect(MAX_EXECUTABLE_PERMISSION).toBe('READ_ONLY');
      expect(ask('knowledge_search')).toEqual({
        allowed: true,
        tool: 'knowledge_search',
        permission: 'READ_ONLY',
      });
    });
  });

  describe('presupuesto de llamadas', () => {
    it('deniega al alcanzar el tope del turno', () => {
      const decision = ask('knowledge_search', {
        configuration: config({ guardrails: { maxToolCallsPerRun: 2 } }),
        toolCallsSoFar: 2,
      });

      // Acota el daño de un bucle inducido por contenido malicioso.
      expect(decision.allowed === false && decision.reason).toBe(
        'TOOL_CALL_BUDGET_EXHAUSTED',
      );
    });

    it('permite justo por debajo del tope', () => {
      expect(
        ask('knowledge_search', {
          configuration: config({ guardrails: { maxToolCallsPerRun: 2 } }),
          toolCallsSoFar: 1,
        }).allowed,
      ).toBe(true);
    });

    it('un tope de cero impide cualquier ejecución', () => {
      expect(
        ask('knowledge_search', {
          configuration: config({ guardrails: { maxToolCallsPerRun: 0 } }),
        }).allowed,
      ).toBe(false);
    });
  });

  describe('contrato de la decisión', () => {
    it('toda denegación explica por qué', () => {
      const decision = ask('sql_query');

      expect(
        decision.allowed === false && decision.explanation.length,
      ).toBeGreaterThan(0);
    });

    it('nunca lanza: devolver la decisión explicada es parte del contrato', () => {
      expect(() => ask('')).not.toThrow();
      expect(() => ask('sql_query', { isActive: false })).not.toThrow();
    });

    it('es determinista', () => {
      expect(ask('knowledge_search')).toEqual(ask('knowledge_search'));
      expect(ask('send_email')).toEqual(ask('send_email'));
    });
  });
});

describe('executableTools', () => {
  it('anuncia solo lo que el gate va a permitir', () => {
    const configuration = parseAgentConfiguration({
      tools: [
        { tool: 'knowledge_search', permission: 'READ_ONLY' },
        { tool: 'insight_lookup', permission: 'READ_ONLY' },
        { tool: 'send_email', permission: 'AUTONOMOUS' },
      ],
    });

    // Anunciar una herramienta que se va a denegar produce intentos condenados de antemano.
    expect(executableTools(configuration)).toEqual([
      'knowledge_search',
      'insight_lookup',
    ]);
  });

  it('un agente solo con herramientas de efectos no ofrece ninguna', () => {
    expect(
      executableTools(
        parseAgentConfiguration({
          tools: [{ tool: 'send_email', permission: 'REQUIRES_CONFIRMATION' }],
        }),
      ),
    ).toEqual([]);
  });
});

describe('guardrailDirective', () => {
  it('no añade ruido si no hay guardrails declarados', () => {
    expect(guardrailDirective(defaultAgentConfiguration())).toBe('');
  });

  it('traslada los temas prohibidos y las condiciones de escalado', () => {
    const directive = guardrailDirective(
      parseAgentConfiguration({
        guardrails: {
          forbiddenTopics: ['nóminas'],
          escalateToHumanWhen: ['el cliente pide cancelar el contrato'],
        },
      }),
    );

    expect(directive).toContain('nóminas');
    expect(directive).toContain('cancelar el contrato');
  });
});

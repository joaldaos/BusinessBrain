import {
  AGENT_CAPABILITIES,
  InvalidAgentConfigurationError,
  defaultAgentConfiguration,
  parseAgentConfiguration,
} from './agent-configuration';

/**
 * Configuración de agente — §7.4.
 *
 * El foco: en el esquema estas cuatro columnas son `Json` libre, así que TODO lo que impide
 * persistir una configuración imposible vive aquí. Lo que se prueba es qué se rechaza.
 */
describe('parseAgentConfiguration', () => {
  const parse = (input: Parameters<typeof parseAgentConfiguration>[0]) =>
    parseAgentConfiguration(input);

  const problemsOf = (input: Parameters<typeof parseAgentConfiguration>[0]) => {
    try {
      parse(input);
      throw new Error('se esperaba que la configuración fuera rechazada');
    } catch (error) {
      if (!(error instanceof InvalidAgentConfigurationError)) throw error;
      return error.problems;
    }
  };

  describe('valores por defecto', () => {
    it('un agente que no declara nada no puede hacer nada', () => {
      const config = parse({});

      // Las capacidades se conceden, no se presuponen.
      expect(config.tools).toEqual([]);
      expect(config.memoryConfig.strategy).toBe('none');
      expect(config.capabilities).toEqual(['answer_questions']);
    });

    it('los valores por defecto son ellos mismos una configuración válida', () => {
      expect(parse(defaultAgentConfiguration())).toEqual(
        defaultAgentConfiguration(),
      );
    });
  });

  describe('herramientas', () => {
    it('rechaza una herramienta que la plataforma no reconoce', () => {
      expect(
        problemsOf({
          tools: [{ tool: 'borrar_produccion', permission: 'AUTONOMOUS' }],
        }),
      ).toEqual([expect.stringContaining('borrar_produccion')]);
    });

    it('rechaza un permiso inventado', () => {
      expect(
        problemsOf({ tools: [{ tool: 'sql_query', permission: 'ADMIN' }] }),
      ).toEqual([expect.stringContaining('ADMIN')]);
    });

    it('rechaza declarar READ_ONLY una herramienta con efectos', () => {
      // Es la mentira exacta que el gate de políticas usaría para dejarla pasar.
      expect(
        problemsOf({
          tools: [{ tool: 'send_email', permission: 'READ_ONLY' }],
        }),
      ).toEqual([expect.stringContaining('send_email')]);
    });

    it('acepta READ_ONLY en una herramienta sin efectos', () => {
      expect(
        parse({
          tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
        }).tools,
      ).toEqual([{ tool: 'knowledge_search', permission: 'READ_ONLY' }]);
    });

    it('acepta una herramienta con efectos si declara un permiso acorde', () => {
      expect(
        parse({
          tools: [{ tool: 'send_email', permission: 'REQUIRES_CONFIRMATION' }],
        }).tools,
      ).toEqual([{ tool: 'send_email', permission: 'REQUIRES_CONFIRMATION' }]);
    });

    it('rechaza la misma herramienta declarada dos veces', () => {
      // Con dos permisos distintos quedaría indefinido cuál gana.
      expect(
        problemsOf({
          tools: [
            { tool: 'sql_query', permission: 'READ_ONLY' },
            { tool: 'sql_query', permission: 'AUTONOMOUS' },
          ],
        }),
      ).toEqual([expect.stringContaining('más de una vez')]);
    });

    it('rechaza una entrada que no es un objeto {tool, permission}', () => {
      expect(problemsOf({ tools: ['sql_query'] })).toEqual([
        expect.stringContaining('tools[0]'),
      ]);
    });
  });

  describe('memoria', () => {
    it('rechaza una estrategia inexistente', () => {
      expect(problemsOf({ memoryConfig: { strategy: 'telepatia' } })).toEqual([
        expect.stringContaining('telepatia'),
      ]);
    });

    it('rechaza una ventana de memoria no positiva', () => {
      expect(
        problemsOf({ memoryConfig: { strategy: 'short_term', windowSize: 0 } }),
      ).toEqual([expect.stringContaining('windowSize')]);
    });

    it('rechaza una ventana desmesurada: compite por el presupuesto de contexto', () => {
      expect(
        problemsOf({
          memoryConfig: { strategy: 'long_term', windowSize: 5000 },
        }),
      ).toEqual([expect.stringContaining('windowSize')]);
    });

    it('acepta una configuración de memoria razonable', () => {
      expect(
        parse({ memoryConfig: { strategy: 'long_term', windowSize: 20 } })
          .memoryConfig,
      ).toEqual({ strategy: 'long_term', windowSize: 20 });
    });
  });

  describe('guardrails', () => {
    it('rechaza un tope de llamadas negativo', () => {
      expect(problemsOf({ guardrails: { maxToolCallsPerRun: -1 } })).toEqual([
        expect.stringContaining('maxToolCallsPerRun'),
      ]);
    });

    it('acepta un tope de cero: un agente que no ejecuta ninguna herramienta', () => {
      expect(
        parse({ guardrails: { maxToolCallsPerRun: 0 } }).guardrails
          .maxToolCallsPerRun,
      ).toBe(0);
    });

    it('descarta entradas vacías de las listas en vez de guardarlas', () => {
      expect(
        parse({ guardrails: { forbiddenTopics: ['nóminas', '', '  '] } })
          .guardrails.forbiddenTopics,
      ).toEqual(['nóminas']);
    });
  });

  describe('informe de errores', () => {
    it('acumula TODOS los problemas, no solo el primero', () => {
      const problems = problemsOf({
        capabilities: ['volar'],
        tools: [{ tool: 'inexistente', permission: 'READ_ONLY' }],
        memoryConfig: { strategy: 'telepatia' },
        guardrails: { maxToolCallsPerRun: -3 },
      });

      // Quien configura un agente necesita la lista completa, no descubrirlos de uno en uno.
      expect(problems).toHaveLength(4);
    });

    it('el mensaje enumera las opciones válidas', () => {
      expect(problemsOf({ capabilities: ['volar'] })[0]).toContain(
        AGENT_CAPABILITIES[0],
      );
    });
  });

  it('es determinista', () => {
    const input = {
      capabilities: ['answer_questions', 'summarize'],
      tools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
      memoryConfig: { strategy: 'short_term', windowSize: 5 },
      guardrails: { forbiddenTopics: ['nóminas'], maxToolCallsPerRun: 3 },
    };

    expect(parse(input)).toEqual(parse(input));
  });

  it('no duplica una capacidad declarada dos veces', () => {
    expect(
      parse({ capabilities: ['summarize', 'summarize'] }).capabilities,
    ).toEqual(['summarize']);
  });
});

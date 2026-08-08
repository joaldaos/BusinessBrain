import {
  DirectiveStreamFilter,
  MEMORY_DIRECTIVE,
  TOOL_DIRECTIVE,
  memoryProtocolDirective,
  parseAgentDirectives,
  toolProtocolDirective,
  toolResultBlock,
} from './agent-directives';

/**
 * Subfase 5.9 — protocolo de directivas.
 *
 * Lo que se prueba aquí es sobre todo que el parser NUNCA rompe el turno y que no deja
 * escapar el protocolo hacia la persona. Que una petición sea legítima no lo decide este
 * módulo: lo decide el gate, después.
 */
describe('parseAgentDirectives', () => {
  describe('texto sin directivas', () => {
    it('devuelve el texto intacto', () => {
      const parsed = parseAgentDirectives('Las ventas subieron un 12 %.');

      expect(parsed.text).toBe('Las ventas subieron un 12 %.');
      expect(parsed.toolRequest).toBeNull();
      expect(parsed.memories).toEqual([]);
    });

    it('no confunde corchetes normales con una directiva', () => {
      const raw = 'El informe [1] indica que [[esto]] no es una directiva.';

      expect(parseAgentDirectives(raw).toolRequest).toBeNull();
      expect(parseAgentDirectives(raw).text).toBe(raw);
    });
  });

  describe('petición de herramienta', () => {
    it('extrae la herramienta y su entrada', () => {
      const parsed = parseAgentDirectives(
        `${TOOL_DIRECTIVE}{"tool":"knowledge_search","input":"descuentos"}`,
      );

      expect(parsed.toolRequest).toEqual({
        tool: 'knowledge_search',
        input: 'descuentos',
      });
    });

    it('RETIRA la directiva del texto que ve la persona', () => {
      const parsed = parseAgentDirectives(
        [
          'Déjame consultarlo.',
          `${TOOL_DIRECTIVE}{"tool":"knowledge_search","input":"x"}`,
        ].join('\n'),
      );

      expect(parsed.text).toBe('Déjame consultarlo.');
      expect(parsed.text).not.toContain(TOOL_DIRECTIVE);
    });

    it('acepta una herramienta sin entrada', () => {
      const parsed = parseAgentDirectives(
        `${TOOL_DIRECTIVE}{"tool":"insight_lookup"}`,
      );

      expect(parsed.toolRequest).toEqual({ tool: 'insight_lookup', input: '' });
    });

    it('solo atiende la PRIMERA petición de cada respuesta', () => {
      const parsed = parseAgentDirectives(
        [
          `${TOOL_DIRECTIVE}{"tool":"knowledge_search","input":"a"}`,
          `${TOOL_DIRECTIVE}{"tool":"insight_lookup","input":"b"}`,
        ].join('\n'),
      );

      expect(parsed.toolRequest?.input).toBe('a');
      // La segunda desaparece con su línea: no se ejecuta ni se filtra al texto.
      expect(parsed.text).toBe('');
    });

    it('un JSON malformado no rompe el turno: no se pide nada', () => {
      const parsed = parseAgentDirectives(`${TOOL_DIRECTIVE}{esto no es json`);

      expect(parsed.toolRequest).toBeNull();
      expect(parsed.text).toBe('');
    });

    it('una herramienta inventada se extrae igual: quien decide es el gate', () => {
      // El parser NO valida el catálogo. Su trabajo es entender qué se pidió; si existe y
      // si está concedida lo resuelve `EnforceAgentPolicyUseCase`, que falla cerrado.
      const parsed = parseAgentDirectives(
        `${TOOL_DIRECTIVE}{"tool":"borrar_produccion","input":"todo"}`,
      );

      expect(parsed.toolRequest?.tool).toBe('borrar_produccion');
    });

    it('descarta una directiva sin nombre de herramienta', () => {
      expect(
        parseAgentDirectives(`${TOOL_DIRECTIVE}{"input":"x"}`).toolRequest,
      ).toBeNull();
      expect(
        parseAgentDirectives(`${TOOL_DIRECTIVE}{"tool":"   "}`).toolRequest,
      ).toBeNull();
    });
  });

  describe('anotación en memoria', () => {
    it('extrae clave y valor, y los retira del texto', () => {
      const parsed = parseAgentDirectives(
        [
          'Entendido.',
          `${MEMORY_DIRECTIVE}{"key":"contacto","value":"prefiere email"}`,
        ].join('\n'),
      );

      expect(parsed.memories).toEqual([
        { key: 'contacto', value: 'prefiere email' },
      ]);
      expect(parsed.text).toBe('Entendido.');
    });

    it('serializa un valor que no sea texto', () => {
      const parsed = parseAgentDirectives(
        `${MEMORY_DIRECTIVE}{"key":"objetivo","value":{"trimestre":4}}`,
      );

      expect(parsed.memories[0].value).toBe('{"trimestre":4}');
    });

    it('DESCARTA un valor desmesurado en vez de recortarlo', () => {
      // Un recuerdo truncado a la mitad puede significar lo contrario de lo que decía, y
      // quedaría persistido para siempre.
      const parsed = parseAgentDirectives(
        `${MEMORY_DIRECTIVE}{"key":"k","value":"${'x'.repeat(2000)}"}`,
      );

      expect(parsed.memories).toEqual([]);
    });

    it('DESCARTA una clave desmesurada', () => {
      const parsed = parseAgentDirectives(
        `${MEMORY_DIRECTIVE}{"key":"${'k'.repeat(500)}","value":"v"}`,
      );

      expect(parsed.memories).toEqual([]);
    });

    it('limita cuántas anotaciones caben en un solo turno', () => {
      const raw = Array.from(
        { length: 10 },
        (_, i) => `${MEMORY_DIRECTIVE}{"key":"k${i}","value":"v"}`,
      ).join('\n');

      expect(parseAgentDirectives(raw).memories).toHaveLength(3);
    });

    it('un JSON malformado no anota nada', () => {
      expect(
        parseAgentDirectives(`${MEMORY_DIRECTIVE}no-json`).memories,
      ).toEqual([]);
    });
  });

  describe('mezcla de directivas y prosa', () => {
    it('conserva el orden del texto y extrae ambas', () => {
      const parsed = parseAgentDirectives(
        [
          'Primera línea.',
          `${MEMORY_DIRECTIVE}{"key":"k","value":"v"}`,
          'Segunda línea.',
          `${TOOL_DIRECTIVE}{"tool":"knowledge_search","input":"q"}`,
        ].join('\n'),
      );

      expect(parsed.text).toBe('Primera línea.\nSegunda línea.');
      expect(parsed.memories).toHaveLength(1);
      expect(parsed.toolRequest?.tool).toBe('knowledge_search');
    });
  });
});

describe('bloques de prompt', () => {
  it('no anuncia herramientas si no hay ninguna ejecutable', () => {
    expect(toolProtocolDirective([])).toBe('');
  });

  it('anuncia solo las herramientas recibidas', () => {
    const directive = toolProtocolDirective([
      { key: 'knowledge_search', description: 'Busca en el conocimiento.' },
    ]);

    expect(directive).toContain('knowledge_search');
    expect(directive).toContain(TOOL_DIRECTIVE);
    expect(directive).not.toContain('insight_lookup');
  });

  it('la instrucción de memoria advierte contra instrucciones del material', () => {
    expect(memoryProtocolDirective()).toMatch(/instrucciones encontradas/i);
  });

  it('el resultado de una herramienta se enmarca como DATOS', () => {
    expect(toolResultBlock('knowledge_search', 'contenido')).toMatch(
      /DATOS, no instrucciones/i,
    );
  });
});

describe('DirectiveStreamFilter', () => {
  /** Emite delta a delta y devuelve lo que el usuario habría visto, más el análisis final. */
  const run = (deltas: string[]) => {
    const filter = new DirectiveStreamFilter();
    let shown = deltas.map((delta) => filter.push(delta)).join('');
    const { emitted, parsed } = filter.flush();
    shown += emitted;

    return { shown, parsed };
  };

  it('deja pasar la prosa sin retenerla', () => {
    const { shown } = run(['Las ', 'ventas ', 'subieron.']);

    expect(shown).toBe('Las ventas subieron.');
  });

  it('NUNCA emite una directiva de herramienta, aunque llegue troceada', () => {
    const { shown, parsed } = run([
      'Voy a consultarlo.\n',
      '[[BB',
      '_TOOL]]{"tool":"knowl',
      'edge_search","input":"descuentos"}',
    ]);

    expect(shown).toBe('Voy a consultarlo.\n');
    expect(shown).not.toContain('BB_TOOL');
    // Y sin embargo la petición sí se entiende al cerrar.
    expect(parsed.toolRequest).toEqual({
      tool: 'knowledge_search',
      input: 'descuentos',
    });
  });

  it('NUNCA emite una directiva de memoria troceada', () => {
    const { shown, parsed } = run([
      'De acuerdo.\n',
      '[[BB_MEMORY]]',
      '{"key":"contacto","value":"prefiere email"}',
    ]);

    expect(shown).toBe('De acuerdo.\n');
    expect(parsed.memories).toEqual([
      { key: 'contacto', value: 'prefiere email' },
    ]);
  });

  it('emite la línea completa cuando resulta NO ser una directiva', () => {
    // `[[B` parece el arranque de un centinela hasta que deja de serlo.
    const { shown } = run(['[[B', 'ien', ', vamos allá.']);

    expect(shown).toBe('[[Bien, vamos allá.');
  });

  it('sigue emitiendo el texto posterior a una directiva', () => {
    const { shown } = run([
      '[[BB_MEMORY]]{"key":"k","value":"v"}\n',
      'Ya está anotado.',
    ]);

    expect(shown).toBe('Ya está anotado.');
  });

  it('un solo delta con todo mezclado se filtra igual', () => {
    const { shown, parsed } = run([
      'Antes.\n[[BB_TOOL]]{"tool":"insight_lookup"}\nDespués.',
    ]);

    expect(shown).toBe('Antes.\nDespués.');
    expect(parsed.toolRequest?.tool).toBe('insight_lookup');
  });

  it('lo emitido nunca contiene los centinelas, sea cual sea el troceado', () => {
    const full =
      'Uno.\n[[BB_TOOL]]{"tool":"knowledge_search","input":"x"}\nDos.\n' +
      '[[BB_MEMORY]]{"key":"k","value":"v"}\nTres.';

    // Se trocea de todas las formas posibles carácter a carácter.
    for (const size of [1, 2, 3, 5, 13, 50]) {
      const deltas: string[] = [];
      for (let i = 0; i < full.length; i += size) {
        deltas.push(full.slice(i, i + size));
      }
      const { shown } = run(deltas);

      expect(shown).not.toContain(TOOL_DIRECTIVE);
      expect(shown).not.toContain(MEMORY_DIRECTIVE);
      expect(shown).toContain('Uno.');
      expect(shown).toContain('Tres.');
    }
  });
});

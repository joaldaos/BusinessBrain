import {
  InvalidReportTemplateError,
  MAX_ITEMS_PER_SECTION,
  MAX_SECTIONS_PER_REPORT,
  DEFAULT_ITEMS_PER_SECTION,
  parseReportTemplate,
} from './report-template';

/**
 * Fase 6 — un informe no puede ver más que quien lo pide.
 *
 * Lo que se prueba: que una plantilla no pueda declarar ninguna forma de leer que esquive los
 * dos puntos de lectura del sistema, y que lo que no se entiende se rechace en lugar de
 * omitirse — un informe incompleto presentado como completo es peor que uno que no se genera.
 */
describe('parseReportTemplate', () => {
  it('acepta las secciones del catálogo', () => {
    const template = parseReportTemplate({
      sections: [
        { type: 'INSIGHTS', title: 'Qué hemos comprendido', limit: 5 },
        {
          type: 'KNOWLEDGE_SEARCH',
          title: 'Sobre márgenes',
          query: 'política de descuentos',
          limit: 3,
        },
      ],
    });

    expect(template.sections).toEqual([
      { type: 'INSIGHTS', title: 'Qué hemos comprendido', limit: 5 },
      {
        type: 'KNOWLEDGE_SEARCH',
        title: 'Sobre márgenes',
        query: 'política de descuentos',
        limit: 3,
      },
    ]);
  });

  describe('el catálogo es CERRADO', () => {
    it.each([
      [
        'consulta SQL',
        { type: 'SQL', title: 'x', sql: 'SELECT * FROM "Insight"' },
      ],
      ['tipo inventado', { type: 'RAW_QUERY', title: 'x', query: 'todo' }],
      ['sin tipo', { title: 'x' }],
    ])('RECHAZA %s', (_caso, section) => {
      // Aceptarlo permitiría pedir a la base de datos algo que ningún punto de lectura ha
      // filtrado por alcance: exactamente lo que la prohibición de SQL libre impide.
      expect(() => parseReportTemplate({ sections: [section] })).toThrow(
        InvalidReportTemplateError,
      );
    });

    it('una sección desconocida NO se omite en silencio junto a otras válidas', () => {
      expect(() =>
        parseReportTemplate({
          sections: [
            { type: 'INSIGHTS', title: 'Válida', limit: 5 },
            { type: 'SQL', title: 'Colada', sql: 'SELECT 1' },
          ],
        }),
      ).toThrow(/tipo desconocido/i);
    });
  });

  describe('cada sección declara lo que necesita', () => {
    it('KNOWLEDGE_SEARCH exige la pregunta', () => {
      expect(() =>
        parseReportTemplate({
          sections: [{ type: 'KNOWLEDGE_SEARCH', title: 'x', limit: 3 }],
        }),
      ).toThrow(/query/);
    });

    it('toda sección exige título: un informe sin encabezados no se lee', () => {
      expect(() =>
        parseReportTemplate({ sections: [{ type: 'INSIGHTS', limit: 3 }] }),
      ).toThrow(/title/);
    });

    it('acota los tipos de Insight contra el enum real', () => {
      expect(() =>
        parseReportTemplate({
          sections: [
            {
              type: 'INSIGHTS',
              title: 'x',
              limit: 3,
              insightTypes: ['ANOMALY', 'INVENTADO'],
            },
          ],
        }),
      ).toThrow(/no es un tipo de Insight/i);
    });

    it('acepta tipos de Insight válidos', () => {
      const template = parseReportTemplate({
        sections: [
          {
            type: 'INSIGHTS',
            title: 'Riesgos',
            limit: 3,
            insightTypes: ['RISK'],
          },
        ],
      });

      expect(template.sections[0]).toMatchObject({ insightTypes: ['RISK'] });
    });
  });

  describe('todo está acotado', () => {
    it('sin límite explícito toma uno por defecto, nunca "todo"', () => {
      const template = parseReportTemplate({
        sections: [{ type: 'INSIGHTS', title: 'x' }],
      });

      expect(template.sections[0].limit).toBe(DEFAULT_ITEMS_PER_SECTION);
    });

    it('una sección no puede arrastrar la organización entera a un PDF', () => {
      expect(() =>
        parseReportTemplate({
          sections: [
            { type: 'INSIGHTS', title: 'x', limit: MAX_ITEMS_PER_SECTION + 1 },
          ],
        }),
      ).toThrow(/limit/);
    });

    it.each([0, -1, 2.5, 'muchos'])('rechaza el límite %s', (limit) => {
      expect(() =>
        parseReportTemplate({
          sections: [{ type: 'INSIGHTS', title: 'x', limit }],
        }),
      ).toThrow(InvalidReportTemplateError);
    });

    it('un informe sin secciones no informa de nada', () => {
      expect(() => parseReportTemplate({ sections: [] })).toThrow(
        /al menos una sección/i,
      );
    });

    it('el número de secciones está acotado', () => {
      const demasiadas = Array.from(
        { length: MAX_SECTIONS_PER_REPORT + 1 },
        (_, index) => ({ type: 'INSIGHTS', title: `s${index}`, limit: 1 }),
      );

      expect(() => parseReportTemplate({ sections: demasiadas })).toThrow(
        /más de/i,
      );
    });

    it.each([
      ['no es un objeto', []],
      ['es nula', null],
      ['sin secciones declaradas', {}],
    ])('%s', (_caso, raw) => {
      expect(() => parseReportTemplate(raw)).toThrow(
        InvalidReportTemplateError,
      );
    });
  });

  describe('la confianza solo puede endurecerse', () => {
    it('acepta un piso dentro de rango', () => {
      const template = parseReportTemplate({
        sections: [{ type: 'INSIGHTS', title: 'x', minimumConfidence: 0.8 }],
      });

      expect(template.sections[0]).toMatchObject({ minimumConfidence: 0.8 });
    });

    it.each([-0.1, 1.5, 'alta'])('rechaza el piso %s', (minimumConfidence) => {
      expect(() =>
        parseReportTemplate({
          sections: [{ type: 'INSIGHTS', title: 'x', minimumConfidence }],
        }),
      ).toThrow(InvalidReportTemplateError);
    });
  });
});

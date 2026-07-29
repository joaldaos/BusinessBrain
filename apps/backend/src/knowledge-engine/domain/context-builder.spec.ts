import {
  DEFAULT_KNOWLEDGE_TOKEN_BUDGET,
  buildContext,
  citationLabel,
  estimateTokens,
  type ContextCandidate,
} from './context-builder';

/**
 * Context Builder — KNOWLEDGE_ENGINE_DESIGN.md §14.
 *
 * El foco: el presupuesto se respeta SIN cortar nunca un fragmento a la mitad, y el orden
 * de relevancia que llega del Retriever se preserva intacto.
 */
describe('buildContext (§14)', () => {
  const candidate = (
    id: string,
    overrides: Partial<ContextCandidate> = {},
  ): ContextCandidate => ({
    chunkId: id,
    content: overrides.content ?? `Contenido del fragmento ${id}`,
    confidenceScore: overrides.confidenceScore ?? 0.8,
    citation: overrides.citation ?? {
      knowledgeItemId: `item-${id}`,
      title: 'Política de Vacaciones',
      chunkIndex: 0,
      heading: 'Ausencias',
      headingPath: ['Política de Vacaciones', 'Ausencias'],
    },
  });

  it('preserva el orden de relevancia que llega del Retriever', () => {
    const result = buildContext([
      candidate('primero'),
      candidate('segundo'),
      candidate('tercero'),
    ]);

    expect(result.pieces.map((p) => p.chunkId)).toEqual([
      'primero',
      'segundo',
      'tercero',
    ]);
    expect(result.pieces.map((p) => p.ordinal)).toEqual([1, 2, 3]);
  });

  it('nunca excede el presupuesto de tokens', () => {
    const largo = 'palabra '.repeat(500);
    const result = buildContext(
      Array.from({ length: 20 }, (_, i) =>
        candidate(`c${i}`, { content: largo }),
      ),
      1000,
    );

    expect(result.usedTokens).toBeLessThanOrEqual(1000);
  });

  it('descarta fragmentos ENTEROS: nunca trunca uno a la mitad', () => {
    const largo = 'x'.repeat(8000);
    const result = buildContext(
      [
        candidate('cabe', { content: 'corto' }),
        candidate('no-cabe', { content: largo }),
      ],
      200,
    );

    // El que entra conserva su contenido íntegro; el que no cabe se descarta completo.
    expect(result.pieces).toHaveLength(1);
    expect(result.pieces[0].content).toBe('corto');
    expect(result.droppedChunkIds).toEqual(['no-cabe']);
  });

  it('informa de lo descartado: nunca se pierde en silencio', () => {
    const result = buildContext(
      Array.from({ length: 5 }, (_, i) =>
        candidate(`c${i}`, { content: 'y'.repeat(2000) }),
      ),
      600,
    );

    expect(result.droppedChunkIds.length).toBeGreaterThan(0);
    expect(result.pieces.length + result.droppedChunkIds.length).toBe(5);
  });

  it('un fragmento demasiado grande no impide que entren los siguientes', () => {
    const result = buildContext(
      [
        candidate('gigante', { content: 'z'.repeat(10000) }),
        candidate('pequeño', { content: 'cabe de sobra' }),
      ],
      500,
    );

    expect(result.droppedChunkIds).toEqual(['gigante']);
    expect(result.pieces.map((p) => p.chunkId)).toEqual(['pequeño']);
  });

  it('cada pieza entregada lleva su cita completa (§14)', () => {
    const result = buildContext([candidate('a')]);

    expect(result.pieces[0].citation).toEqual({
      knowledgeItemId: 'item-a',
      title: 'Política de Vacaciones',
      chunkIndex: 0,
      heading: 'Ausencias',
      headingPath: ['Política de Vacaciones', 'Ausencias'],
    });
  });

  it('el bloque incluye la confianza de cada pieza, visible', () => {
    const result = buildContext([candidate('a', { confidenceScore: 0.35 })]);

    // Es lo que permite matizar una respuesta apoyada en contenido poco confiable.
    expect(result.text).toContain('confianza 0.35');
  });

  it('el bloque numera las piezas para que la respuesta pueda citarlas', () => {
    const result = buildContext([candidate('a'), candidate('b')]);

    expect(result.text).toContain('[1]');
    expect(result.text).toContain('[2]');
  });

  it('sin candidatos produce un contexto vacío sin romper', () => {
    const result = buildContext([]);

    expect(result.text).toBe('');
    expect(result.pieces).toEqual([]);
    expect(result.usedTokens).toBe(0);
  });

  it('usa el presupuesto por defecto si no se especifica', () => {
    expect(buildContext([candidate('a')]).budget).toBe(
      DEFAULT_KNOWLEDGE_TOKEN_BUDGET,
    );
  });

  it('es determinista', () => {
    const input = [candidate('a'), candidate('b')];
    expect(buildContext(input)).toEqual(buildContext(input));
  });
});

describe('citationLabel (§14)', () => {
  it('compone documento y ruta de encabezados', () => {
    expect(
      citationLabel({
        knowledgeItemId: 'x',
        title: 'Manual',
        chunkIndex: 0,
        heading: 'Vacaciones',
        headingPath: ['Manual', 'Vacaciones'],
      }),
    ).toBe('Manual › Manual › Vacaciones');
  });

  it('usa solo el título si no hay jerarquía', () => {
    expect(
      citationLabel({
        knowledgeItemId: 'x',
        title: 'Nota suelta',
        chunkIndex: 0,
        heading: null,
        headingPath: [],
      }),
    ).toBe('Nota suelta');
  });
});

describe('estimateTokens', () => {
  it('crece con la longitud del texto', () => {
    expect(estimateTokens('x'.repeat(400))).toBeGreaterThan(
      estimateTokens('x'.repeat(100)),
    );
  });

  it('un texto vacío no cuenta tokens', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

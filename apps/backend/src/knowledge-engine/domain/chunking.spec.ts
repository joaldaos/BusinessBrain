import {
  DEFAULT_CHUNKING_SETTINGS,
  chunkContent,
  getChunkingSettings,
  hashChunkContent,
} from './chunking';

/**
 * Criterio de aceptación de la subfase 2.6 (KNOWLEDGE_ENGINE_DESIGN.md §19):
 * "un documento largo produce chunks coherentes con metadata de posición".
 */
describe('chunkContent (§11)', () => {
  const structuredDoc = [
    '# Manual del empleado',
    '',
    'Introducción general al manual y su alcance dentro de la organización.',
    '',
    '## Vacaciones',
    '',
    'Los empleados disponen de 23 días laborables de vacaciones al año natural.',
    '',
    '## Dietas',
    '',
    '| Concepto | Importe |',
    '| --- | --- |',
    '| Comida | 12 EUR |',
    '| Cena | 20 EUR |',
  ].join('\n');

  it('respeta los límites estructurales: no mezcla secciones distintas', () => {
    const chunks = chunkContent(structuredDoc);

    const vacaciones = chunks.find((c) => c.content.includes('23 días'));
    expect(vacaciones).toBeDefined();
    expect(vacaciones!.content).not.toContain('Comida');
  });

  it('conserva la ruta jerárquica de encabezados para la cita (§14)', () => {
    const chunks = chunkContent(structuredDoc);
    const vacaciones = chunks.find((c) => c.content.includes('23 días'))!;

    expect(vacaciones.metadata.heading).toBe('Vacaciones');
    expect(vacaciones.metadata.headingPath).toEqual([
      'Manual del empleado',
      'Vacaciones',
    ]);
  });

  it('registra la posición en el documento original', () => {
    const chunks = chunkContent(structuredDoc);

    for (const chunk of chunks) {
      expect(chunk.metadata.startOffset).toBeGreaterThanOrEqual(0);
      expect(chunk.metadata.endOffset).toBeGreaterThan(
        chunk.metadata.startOffset,
      );
    }
  });

  it('mantiene una tabla como unidad atómica: no la corta a mitad de fila (§11)', () => {
    const chunks = chunkContent(structuredDoc);
    const table = chunks.find((c) => c.metadata.blockKind === 'table');

    expect(table).toBeDefined();
    expect(table!.content).toContain('Comida');
    expect(table!.content).toContain('Cena');
  });

  it('mantiene un bloque de código como unidad atómica', () => {
    const doc = [
      '# Guía técnica',
      '',
      '```sql',
      'SELECT * FROM empleados',
      'WHERE activo = true;',
      '```',
    ].join('\n');

    const code = chunkContent(doc).find((c) => c.metadata.blockKind === 'code');
    expect(code).toBeDefined();
    expect(code!.content).toContain('SELECT');
    expect(code!.content).toContain('WHERE');
  });

  it('índices ordinales contiguos empezando en cero', () => {
    const chunks = chunkContent(structuredDoc);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('aplica la estrategia de respaldo con solape en contenido sin estructura (§11)', () => {
    const flat = 'palabra '.repeat(1200);
    const chunks = chunkContent(flat);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.metadata.fallback)).toBe(true);
    expect(
      chunks.every(
        (c) => c.content.length <= DEFAULT_CHUNKING_SETTINGS.targetSize,
      ),
    ).toBe(true);
  });

  it('el solape evita perder una idea partida por un corte', () => {
    const flat = 'x'.repeat(3000);
    const chunks = chunkContent(flat);

    // Fragmentos consecutivos se superponen: el segundo empieza antes de que acabe el primero.
    expect(chunks[1].metadata.startOffset).toBeLessThan(
      chunks[0].metadata.endOffset,
    );
  });

  it('fusiona fragmentos demasiado pequeños en vez de dejarlos sueltos', () => {
    const doc = ['# T', '', 'Corto.', '', 'También corto.'].join('\n');
    const chunks = chunkContent(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('Corto.');
    expect(chunks[0].content).toContain('También corto.');
  });

  it('no fusiona fragmentos de secciones distintas aunque sean cortos', () => {
    const doc = ['# A', '', 'Uno.', '', '# B', '', 'Dos.'].join('\n');
    const chunks = chunkContent(doc);

    const contents = chunks.map((c) => c.content);
    expect(contents.some((c) => c.includes('Uno.') && c.includes('Dos.'))).toBe(
      false,
    );
  });

  it('un documento vacío no produce fragmentos ni rompe', () => {
    expect(chunkContent('')).toEqual([]);
    expect(chunkContent('   \n\n  ')).toEqual([]);
  });

  it('es determinista: el mismo documento produce siempre los mismos fragmentos', () => {
    expect(chunkContent(structuredDoc)).toEqual(chunkContent(structuredDoc));
  });

  it('el hash del fragmento usa el contenido canónico (§3.12)', () => {
    // Diferencias de formato no cambian la identidad del fragmento: es lo que permite
    // reutilizar el cómputo del vector entre contenido equivalente (§7).
    expect(hashChunkContent('Hola   mundo')).toBe(
      hashChunkContent('hola\nMUNDO'),
    );
    expect(hashChunkContent('Hola mundo')).not.toBe(
      hashChunkContent('Adiós mundo'),
    );
  });
});

describe('getChunkingSettings (§11, umbrales como configuración)', () => {
  it('usa los valores de plataforma por defecto', () => {
    expect(getChunkingSettings(null)).toEqual(DEFAULT_CHUNKING_SETTINGS);
  });

  it('respeta la configuración de la organización', () => {
    const settings = getChunkingSettings({
      knowledgeEngine: { chunking: { targetSize: 800 } },
    });
    expect(settings.targetSize).toBe(800);
  });

  it('rechaza un solape mayor o igual que el tamaño: produciría avance nulo', () => {
    const settings = getChunkingSettings({
      knowledgeEngine: { chunking: { targetSize: 500, overlap: 900 } },
    });
    expect(settings.overlap).toBe(DEFAULT_CHUNKING_SETTINGS.overlap);
  });
});

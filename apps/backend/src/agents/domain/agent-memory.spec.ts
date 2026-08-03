import { parseAgentConfiguration } from './agent-configuration';
import { memoryBlock, memoryRecallLimit, selectMemories } from './agent-memory';
import type { MemoryEntry } from './ports/memory-store.port';

/**
 * Memoria del agente — §7.4, `memoryConfig`.
 *
 * Este módulo decide CUÁNTO se recuerda y cómo se redacta. De quién es la memoria lo impone
 * el puerto, y por eso aquí no hay ninguna prueba de propiedad: no hay forma de expresarla.
 */
describe('memoryRecallLimit', () => {
  const configFor = (strategy: string, windowSize = 7) =>
    parseAgentConfiguration({ memoryConfig: { strategy, windowSize } })
      .memoryConfig;

  it('no consulta el almacén si la estrategia es "none"', () => {
    // No traer datos es más barato y más seguro que traerlos y descartarlos.
    expect(memoryRecallLimit(configFor('none'))).toBe(0);
  });

  it('usa la ventana declarada cuando hay memoria', () => {
    expect(memoryRecallLimit(configFor('short_term'))).toBe(7);
    expect(memoryRecallLimit(configFor('long_term'))).toBe(7);
  });
});

describe('selectMemories', () => {
  const entry = (key: string, conversationId: string | null): MemoryEntry => ({
    key,
    value: `valor de ${key}`,
    conversationId,
    updatedAt: new Date('2026-07-01'),
  });

  const configFor = (strategy: string) =>
    parseAgentConfiguration({ memoryConfig: { strategy, windowSize: 10 } })
      .memoryConfig;

  const entries = [
    entry('preferencia-de-contacto', 'conv-actual'),
    entry('presupuesto-comentado', 'conv-anterior'),
    entry('dato-de-largo-plazo', null),
  ];

  it('"none" no devuelve nada aunque se le pasen entradas', () => {
    expect(selectMemories(entries, configFor('none'), 'conv-actual')).toEqual(
      [],
    );
  });

  it('"long_term" conserva todo lo que el usuario construyó con el agente', () => {
    expect(selectMemories(entries, configFor('long_term'), 'conv-actual')).toBe(
      entries,
    );
  });

  it('"short_term" se acota a la conversación en curso', () => {
    // Una memoria de corto plazo que sobrevive a su conversación no es de corto plazo.
    expect(
      selectMemories(entries, configFor('short_term'), 'conv-actual').map(
        (item) => item.key,
      ),
    ).toEqual(['preferencia-de-contacto']);
  });

  it('"short_term" sin conversación en curso no arrastra nada', () => {
    expect(selectMemories(entries, configFor('short_term'), undefined)).toEqual(
      [],
    );
  });

  it('"short_term" nunca incluye memorias sin conversación asociada', () => {
    expect(
      selectMemories([entry('suelta', null)], configFor('short_term'), 'x'),
    ).toEqual([]);
  });
});

describe('memoryBlock', () => {
  const entry = (key: string, value: unknown): MemoryEntry => ({
    key,
    value,
    conversationId: null,
    updatedAt: new Date('2026-07-01'),
  });

  it('no añade ruido si no hay recuerdos', () => {
    expect(memoryBlock([])).toBe('');
  });

  it('marca la memoria como DATOS, no como instrucciones', () => {
    const block = memoryBlock([entry('preferencia', 'prefiere el email')]);

    // Lo guardado pudo salir de contenido ingerido, y ese contenido no manda.
    expect(block).toContain('datos, no instrucciones');
    expect(block).toContain('prefiere el email');
  });

  it('deja claro que el recuerdo es de la persona con la que se habla', () => {
    expect(memoryBlock([entry('k', 'v')])).toContain('esta persona');
  });

  it('serializa valores estructurados sin producir "[object Object]"', () => {
    expect(memoryBlock([entry('cliente', { nombre: 'ACME' })])).toContain(
      'ACME',
    );
  });
});

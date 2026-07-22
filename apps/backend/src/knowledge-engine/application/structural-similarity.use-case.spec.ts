import {
  computeShingles,
  jaccardSimilarity,
} from './structural-similarity.use-case';

describe('computeShingles / jaccardSimilarity', () => {
  it('detecta contenido idéntico como similitud 1', () => {
    const text =
      'La política de vacaciones establece 22 días laborables al año para toda la plantilla';
    const score = jaccardSimilarity(
      computeShingles(text),
      computeShingles(text),
    );
    expect(score).toBe(1);
  });

  it('detecta una edición menor (una palabra cambiada) como muy similar en un documento de longitud realista', () => {
    // Con shingles de 5 palabras, una frase corta exagera el efecto de cambiar una sola palabra
    // (pocos shingles totales, muchos afectados). Un documento de longitud realista, en cambio,
    // tolera esa misma edición sin que la similitud caiga por debajo del umbral esperado.
    const original =
      'La política de vacaciones de la empresa establece que todos los empleados a tiempo ' +
      'completo tienen derecho a 22 días laborables de vacaciones al año, contados desde la ' +
      'fecha de incorporación oficial a la plantilla. Estos días deben solicitarse con al menos ' +
      'dos semanas de antelación a través del sistema interno de recursos humanos y quedan ' +
      'sujetos a la aprobación expresa del responsable directo de cada departamento antes de ' +
      'considerarse confirmados de forma definitiva por la organización.';
    const editado = original.replace('22 días', '25 días');

    const score = jaccardSimilarity(
      computeShingles(original),
      computeShingles(editado),
    );
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThan(1);
  });

  it('detecta contenido completamente distinto como no similar', () => {
    const a = computeShingles(
      'Informe trimestral de ventas del área de operaciones en el tercer trimestre',
    );
    const b = computeShingles(
      'Receta de tarta de manzana con canela y azúcar moreno para seis personas',
    );

    expect(jaccardSimilarity(a, b)).toBeLessThan(0.2);
  });

  it('trata dos textos vacíos como idénticos y uno vacío frente a uno con contenido como no similar', () => {
    expect(jaccardSimilarity(computeShingles(''), computeShingles(''))).toBe(1);
    expect(
      jaccardSimilarity(
        computeShingles(''),
        computeShingles('algo de contenido'),
      ),
    ).toBe(0);
  });

  it('documentos más cortos que el tamaño de shingle se comparan como una única unidad', () => {
    const a = computeShingles('hola mundo');
    const b = computeShingles('hola mundo');
    const c = computeShingles('adiós mundo cruel');

    expect(jaccardSimilarity(a, b)).toBe(1);
    expect(jaccardSimilarity(a, c)).toBe(0);
  });
});

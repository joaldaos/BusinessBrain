import { computeContentHash } from './content-canonicalization';
import {
  computeShingles,
  jaccardSimilarity,
} from '../application/structural-similarity.use-case';

/**
 * Test de contrato (KNOWLEDGE_ENGINE_DESIGN.md S3.12): nivel 1 (computeContentHash) y nivel 2
 * (computeShingles) deben coincidir SIEMPRE en que' cuenta como "el mismo texto". Si alguien
 * modifica cualquiera de las dos funciones para que deje de canonicalizar primero, o para que
 * canonicalice de una forma distinta a la otra, este test debe fallar en CI antes de que ese
 * cambio llegue a produccion - es la garantia real (no solo documental) de que nunca vuelven a
 * existir dos formas distintas de interpretar un documento.
 */
describe('Contrato de canonicalizacion entre nivel 1 y nivel 2', () => {
  const baseText =
    'La politica de vacaciones de la empresa establece que todos los empleados a tiempo ' +
    'completo tienen derecho a 22 dias laborables de vacaciones al año.';

  const onlyFormattingVariants: Record<string, string> = {
    'espacios dobles': baseText.replace(/ /g, '  '),
    tabuladores: baseText.replace(/ /g, '\t'),
    'saltos de linea internos': baseText.replace(/\. /g, '.\n'),
    'lineas en blanco extra': baseText.replace(/\. /g, '.\n\n\n'),
    mayusculas: baseText.toUpperCase(),
    'espacio en los extremos': `   ${baseText}   `,
    'CRLF en vez de LF': baseText.replace(/\n/g, '\r\n'),
  };

  it.each(Object.entries(onlyFormattingVariants))(
    'variante "%s": mismo hash (nivel 1) Y similitud de Jaccard 1.0 (nivel 2)',
    (_label, variant) => {
      expect(computeContentHash(variant)).toBe(computeContentHash(baseText));
      expect(
        jaccardSimilarity(computeShingles(variant), computeShingles(baseText)),
      ).toBe(1);
    },
  );

  it('un cambio de contenido real (no de formato) rompe ambos acuerdos a la vez', () => {
    const realChange = baseText.replace('22 dias', '25 dias');
    expect(computeContentHash(realChange)).not.toBe(
      computeContentHash(baseText),
    );
    expect(
      jaccardSimilarity(computeShingles(realChange), computeShingles(baseText)),
    ).toBeLessThan(1);
  });
});

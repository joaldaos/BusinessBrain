import { canonicalizeContent } from '../domain/content-canonicalization';

const SHINGLE_SIZE = 5;

/**
 * Nivel 2 de deduplicación (KNOWLEDGE_ENGINE_DESIGN.md §7): "huella de similitud de baja
 * dimensionalidad (tipo shingling/minhash)". Se implementa como shingling de palabras +
 * similitud de Jaccard exacta, no MinHash aproximado — a la escala real de la Fase 2 (un
 * conector, subida manual, pocos candidatos por comparación) calcular Jaccard exacto sobre los
 * shingles da la misma calidad de detección que una aproximación, sin la complejidad ni la
 * pérdida de precisión de MinHash, y sin ningún coste que importe a este volumen (§16 solo exige
 * acotar candidatos, no aproximar la propia comparación, a partir de ~10.000 documentos).
 *
 * Opera siempre sobre `canonicalizeContent(text)`, nunca sobre el texto crudo — es el contrato
 * de §3.12 ("Contenido canónico"): nivel 1 (hash) y nivel 2 (esta función) deben coincidir en
 * qué cuenta como "el mismo texto", o dos formas distintas de interpretar un documento producen
 * resultados de deduplicación contradictorios entre sí (defecto real encontrado y corregido en
 * la auditoría de implementación de la Subfase 2.2).
 */
export function computeShingles(text: string, k = SHINGLE_SIZE): Set<string> {
  const words = canonicalizeContent(text)
    .split(' ')
    .filter((word) => word.length > 0);

  if (words.length === 0) return new Set();
  if (words.length < k) return new Set([words.join(' ')]);

  const shingles = new Set<string>();
  for (let i = 0; i <= words.length - k; i++) {
    shingles.add(words.slice(i, i + k).join(' '));
  }
  return shingles;
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersectionSize = 0;
  for (const shingle of a) {
    if (b.has(shingle)) intersectionSize += 1;
  }
  const unionSize = a.size + b.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

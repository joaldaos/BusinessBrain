import { createHash } from 'crypto';

// Espacio de ancho cero (0x200B), union/no-union de ancho cero (0x200C/0x200D) y BOM / espacio
// de no-separacion de ancho cero (0xFEFF) - artefactos invisibles de copiar/pegar entre
// editores, sin ningun caracter visible ni significado. Construido a partir de sus puntos de
// codigo (no escritos como caracteres literales en el fuente) para que quede inequivocamente
// claro, en revision de codigo, que caracteres exactos cubre esta normalizacion.
const INVISIBLE_FORMATTING_CODE_POINTS = [0x200b, 0x200c, 0x200d, 0xfeff];
const INVISIBLE_FORMATTING_CHARS = new RegExp(
  `[${INVISIBLE_FORMATTING_CODE_POINTS.map((codePoint) => String.fromCharCode(codePoint)).join('')}]`,
  'g',
);

/**
 * Contenido canonico (KNOWLEDGE_ENGINE_DESIGN.md S3.12): la unica representacion de un
 * documento que cualquier mecanismo de deduplicacion - presente o futuro - puede usar para
 * decidir si dos contenidos son "el mismo texto". Nunca se persiste como campo propio: es una
 * funcion pura, recalculable en el momento a partir de `contentText`.
 *
 * Transformaciones consideradas equivalentes (no cambian el significado del documento):
 * normalizacion Unicode a forma de composicion canonica (NFC), eliminacion de caracteres
 * invisibles de formato, plegado de mayusculas/minusculas, y colapso de cualquier secuencia de
 * espacios/tabuladores/saltos de linea a un unico espacio.
 *
 * Lo que nunca se toca: palabras, numeros, puntuacion, simbolos, tildes (solo se normaliza su
 * codificacion Unicode, nunca se eliminan), ni el orden de palabras o frases. No hay
 * lematizacion ni eliminacion de palabras vacias - canonicalizar es una operacion de formato,
 * nunca de interpretacion semantica.
 *
 * Plegado de mayusculas con `toLowerCase()` (no `toLocaleLowerCase()`), deliberadamente: el
 * mapeo de mayusculas de `toLowerCase()` no depende del locale de ejecucion - importa para que
 * el mismo contenido produzca siempre el mismo resultado sin importar en que servidor se procese.
 */
export function canonicalizeContent(text: string): string {
  return text
    .normalize('NFC')
    .replace(INVISIBLE_FORMATTING_CHARS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nivel 1 de deduplicacion (S7): hash del contenido canonico, nunca del texto crudo. Punto de
 * entrada obligatorio - nadie debe calcular `sha256` sobre `contentText` directamente.
 */
export function computeContentHash(text: string): string {
  return createHash('sha256').update(canonicalizeContent(text)).digest('hex');
}

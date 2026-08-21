import * as mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import {
  DocumentRejectedError,
  MAX_EXTRACTED_TEXT_LENGTH,
} from '../domain/document-formats';

/**
 * Sacar el texto de un PDF o de un Word.
 *
 * ## Por qué la procedencia de página NO necesita arquitectura nueva
 *
 * El troceado ya reconoce encabezados Markdown (`#{1,6}`) y guarda `heading` y `headingPath` en
 * cada fragmento, y la cita que ve el usuario ya muestra ese encabezado. Emitir `## Página 3`
 * entre las páginas de un PDF hace que cada fragmento herede su página por el mismo camino que
 * hereda un apartado de un documento con secciones — sin un modelo paralelo, sin columnas
 * nuevas y sin tocar el mecanismo de citas.
 *
 * Es la razón de que el texto extraído lleve esos marcadores: no son ruido, son lo que permite
 * responder "esto lo dice la página 3 de tu contrato".
 *
 * ## Qué NO hace
 *
 * No hay OCR. Un PDF escaneado es una imagen y de una imagen no sale texto sin reconocerlo, que
 * es otro problema con otro coste. Se dice con claridad en vez de indexar un documento vacío que
 * después no responde a nada y nadie sabe por qué.
 *
 * Tampoco se ejecuta nada: de un `.docx` solo se lee su texto —es un ZIP con XML— y de un PDF
 * solo su capa de texto. Ni macros, ni JavaScript embebido, ni contenido activo.
 */

/** Marca de página, en el formato de encabezado que el troceado ya sabe leer. */
export function pageHeading(pageNumber: number): string {
  return `## Página ${pageNumber}`;
}

/**
 * Texto de un PDF, página a página.
 *
 * Las páginas sin texto se omiten en vez de dejar un encabezado huérfano: un PDF con una portada
 * en imagen y el resto en texto es normal, y marcar "Página 1" sin contenido debajo daría citas
 * que no llevan a ninguna parte.
 */
export async function extractPdfText(content: Buffer): Promise<string> {
  const pages = await readPdfPages(content);

  const withText = pages
    .map((text, index) => ({
      page: index + 1,
      text: normalizeWhitespace(text),
    }))
    .filter((entry) => entry.text.length > 0);

  if (withText.length === 0) {
    // Casi siempre es un escaneado: páginas que son imágenes.
    throw new DocumentRejectedError(
      'Este PDF no contiene texto que podamos leer. Suele pasar con documentos escaneados o ' +
        'fotografiados. Si tienes una versión digital del documento, súbela en su lugar.',
    );
  }

  return capText(
    withText
      .map((entry) => `${pageHeading(entry.page)}\n\n${entry.text}`)
      .join('\n\n'),
  );
}

async function readPdfPages(content: Buffer): Promise<string[]> {
  try {
    // Importación estática, no dinámica: `unpdf` publica build CommonJS y este backend compila
    // a CommonJS. Con `await import()` el código funcionaba al arrancar y fallaba bajo Jest,
    // que exige `--experimental-vm-modules` para cargar módulos por esa vía.
    const document = await getDocumentProxy(new Uint8Array(content));
    const { text } = await extractText(document, { mergePages: false });

    return Array.isArray(text) ? text : [text];
  } catch (error) {
    if (error instanceof DocumentRejectedError) throw error;

    // El motivo técnico queda en el error original, que la ingesta registra; lo que ve la
    // persona dice qué hacer.
    throw new DocumentRejectedError(
      'No hemos podido leer este PDF. Puede estar dañado o protegido con contraseña: ' +
        'revísalo y vuelve a intentarlo.',
    );
  }
}

/**
 * Texto de un `.docx`.
 *
 * Se pide el texto plano y no el HTML intermedio: lo que necesita el Knowledge Engine es el
 * contenido, y convertir a HTML para volver a quitarle las etiquetas añadiría un paso que solo
 * puede introducir pérdidas.
 */
export async function extractDocxText(content: Buffer): Promise<string> {
  let value: string;
  try {
    ({ value } = await mammoth.extractRawText({ buffer: content }));
  } catch {
    throw new DocumentRejectedError(
      'No hemos podido leer este documento de Word. Puede estar dañado o protegido: ' +
        'revísalo y vuelve a intentarlo.',
    );
  }

  const text = normalizeWhitespace(value);
  if (text.length === 0) {
    throw new DocumentRejectedError(
      'Este documento de Word no tiene texto. Si el contenido son imágenes, no podemos ' +
        'leerlo todavía.',
    );
  }

  return capText(text);
}

function normalizeWhitespace(raw: string): string {
  return (
    raw
      .replace(/\r\n/g, '\n')
      // Los extractores dejan espacios repetidos donde el original tenía tabulaciones o
      // maquetación en columnas.
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Tope del texto extraído.
 *
 * El límite de subida acota el FICHERO, no lo que rinde: un PDF comprimido de pocos megas puede
 * dar decenas de millones de caracteres, y todos ellos se trocean y se vectorizan. Se recorta
 * en vez de rechazar: el principio de un documento largo sigue siendo conocimiento útil.
 */
function capText(text: string): string {
  return text.length > MAX_EXTRACTED_TEXT_LENGTH
    ? text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)
    : text;
}

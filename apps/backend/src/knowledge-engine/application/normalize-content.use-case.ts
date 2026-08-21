import { computeContentHash } from '../domain/content-canonicalization';
import {
  DocumentRejectedError,
  resolveDocumentFormat,
  type DocumentFormat,
} from '../domain/document-formats';
import { extractDocxText, extractPdfText } from './extract-document-text';

export interface NormalizedContent {
  text: string;
  contentHash: string;
}

export class EmptyNormalizedContentError extends DocumentRejectedError {
  constructor() {
    super(
      'Este documento está vacío o no tiene texto que podamos leer. Revísalo y vuelve a ' +
        'intentarlo.',
    );
    this.name = 'EmptyNormalizedContentError';
  }
}

/**
 * Normalización (KNOWLEDGE_ENGINE_DESIGN.md §4, §11): convierte el contenido crudo a texto plano
 * estructurado, independiente del formato de origen. `text` es lo que se ALMACENA (legible,
 * conserva formato humano — las citas y el troceado lo necesitan tal cual). El hash se calcula
 * sobre el contenido CANÓNICO de ese texto (§3.12, `computeContentHash`), nunca sobre `text`
 * directamente — es el único punto de entrada admitido para nivel 1 de deduplicación (§7).
 *
 * ## Un solo sitio para todos los formatos
 *
 * Texto plano, Markdown, HTML, **PDF y Word**. Es deliberadamente el ÚNICO punto donde un
 * formato se convierte en texto, y por eso ampliarlo sirve a todos los conectores a la vez: un
 * PDF que llega por subida manual y otro que llega de Google Drive recorren exactamente el mismo
 * camino. Una segunda tubería para binarios habría dejado a Drive fuera desde el primer día.
 *
 * ## Por qué ahora es asíncrona
 *
 * Extraer texto de un PDF o un Word no es una transformación de cadena: hay que interpretar
 * estructura binaria. El resto del pipeline no cambia — la ingesta la espera y sigue igual.
 *
 * ## Qué NO se acepta
 *
 * Lo que no está en el catálogo, y lo que dice ser algo que su contenido desmiente. Ver
 * `resolveDocumentFormat`: fiarse del nombre del fichero es dejar que quien sube decida a qué
 * intérprete binario llega su contenido.
 */
export async function normalizeContent(
  rawContent: Buffer,
  mimeType: string,
  filename = '',
): Promise<NormalizedContent> {
  const format = resolveDocumentFormat({
    filename,
    declaredMimeType: mimeType,
    content: rawContent,
  });

  const text = await toText(format, rawContent);
  const trimmed = text.replace(/\r\n/g, '\n').trim();

  if (!trimmed) {
    throw new EmptyNormalizedContentError();
  }

  return {
    text: trimmed,
    contentHash: computeContentHash(trimmed),
  };
}

async function toText(
  format: DocumentFormat,
  rawContent: Buffer,
): Promise<string> {
  switch (format) {
    case 'application/pdf':
      return extractPdfText(rawContent);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractDocxText(rawContent);
    case 'text/html':
      return stripHtml(rawContent.toString('utf8'));
    default:
      return rawContent.toString('utf8');
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

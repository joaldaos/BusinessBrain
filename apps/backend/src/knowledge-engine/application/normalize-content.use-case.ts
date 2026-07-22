import { computeContentHash } from '../domain/content-canonicalization';

export interface NormalizedContent {
  text: string;
  contentHash: string;
}

const SUPPORTED_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/html',
] as const;
type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

export class UnsupportedContentTypeError extends Error {
  constructor(mimeType: string) {
    super(
      `Tipo de contenido no soportado todavía por la normalización: "${mimeType}" (soportados: ${SUPPORTED_MIME_TYPES.join(', ')})`,
    );
    this.name = 'UnsupportedContentTypeError';
  }
}

export class EmptyNormalizedContentError extends Error {
  constructor() {
    super('El contenido quedó vacío tras la normalización');
    this.name = 'EmptyNormalizedContentError';
  }
}

/**
 * Normalización básica (KNOWLEDGE_ENGINE_DESIGN.md §4, §11): convierte el contenido crudo a
 * texto plano estructurado, independiente del formato de origen. `text` es lo que se ALMACENA
 * (legible, conserva formato humano — citas y chunking futuro lo necesitan tal cual). El hash se
 * calcula sobre el contenido CANÓNICO de ese texto (§3.12, `computeContentHash`), nunca sobre
 * `text` directamente — es el único punto de entrada admitido para nivel 1 de deduplicación (§7).
 *
 * Soporta en esta subfase texto plano, Markdown (se indexa tal cual, sin renderizar) y HTML
 * (se descartan las etiquetas de forma básica). Cualquier otro tipo MIME se rechaza de forma
 * explícita en vez de fingir una extracción no construida todavía (p. ej. PDF/DOCX binarios) —
 * ampliar la cobertura es añadir un caso aquí, no tocar el resto del pipeline.
 */
export function normalizeContent(
  rawContent: Buffer,
  mimeType: string,
): NormalizedContent {
  const baseMimeType = mimeType.split(';')[0].trim().toLowerCase();

  if (!isSupportedMimeType(baseMimeType)) {
    throw new UnsupportedContentTypeError(baseMimeType);
  }

  const raw = rawContent.toString('utf8');
  const text = baseMimeType === 'text/html' ? stripHtml(raw) : raw;
  const trimmed = text.replace(/\r\n/g, '\n').trim();

  if (!trimmed) {
    throw new EmptyNormalizedContentError();
  }

  return {
    text: trimmed,
    contentHash: computeContentHash(trimmed),
  };
}

function isSupportedMimeType(value: string): value is SupportedMimeType {
  return (SUPPORTED_MIME_TYPES as readonly string[]).includes(value);
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

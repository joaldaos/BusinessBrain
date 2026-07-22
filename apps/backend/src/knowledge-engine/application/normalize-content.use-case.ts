import { createHash } from 'crypto';

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
 * texto plano estructurado, independiente del formato de origen, y calcula el hash del
 * contenido YA normalizado (no del binario original) — base de la deduplicación futura (§7,
 * subfase 2.2), sin consumidor todavía en esta subfase.
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
    contentHash: createHash('sha256').update(trimmed).digest('hex'),
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

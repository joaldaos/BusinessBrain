/**
 * Qué formatos acepta BusinessBrain, y cómo se reconoce uno de verdad — dominio puro.
 *
 * ## Por qué no basta con el nombre ni con el tipo declarado
 *
 * El navegador declara el tipo a partir de la extensión, y la extensión la pone quien sube el
 * fichero. Fiarse de eso significa que `factura.pdf` puede ser cualquier cosa: un ejecutable, un
 * ZIP, un HTML con scripts. Aquí se mira además el PRINCIPIO DEL FICHERO, que es lo único que no
 * se puede renombrar, y si lo declarado y lo real no coinciden se rechaza.
 *
 * No es paranoia abstracta: el contenido que entra acaba en un extractor que interpreta
 * estructura binaria. Dárselo a un parser equivocado es exactamente la superficie de ataque que
 * conviene no abrir.
 *
 * Sin dependencias, sin red, determinista.
 */

export type DocumentFormat =
  | 'text/plain'
  | 'text/markdown'
  | 'text/html'
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface FormatDescriptor {
  format: DocumentFormat;
  /** Cómo se llama para una persona. Aparece en los mensajes de error. */
  label: string;
  extensions: readonly string[];
  /** Tipos que declara un navegador para este formato. Varios por formato es normal. */
  declaredMimeTypes: readonly string[];
  /**
   * Primeros bytes que identifican el formato de verdad, si los tiene.
   *
   * `null` para los formatos de texto: no tienen firma, y exigirles una dejaría fuera cualquier
   * `.txt` legítimo.
   */
  magic: readonly number[] | null;
}

export const SUPPORTED_FORMATS: readonly FormatDescriptor[] = [
  {
    format: 'text/plain',
    label: 'texto',
    extensions: ['.txt'],
    declaredMimeTypes: ['text/plain'],
    magic: null,
  },
  {
    format: 'text/markdown',
    label: 'Markdown',
    extensions: ['.md', '.markdown'],
    declaredMimeTypes: ['text/markdown', 'text/x-markdown'],
    magic: null,
  },
  {
    format: 'text/html',
    label: 'HTML',
    extensions: ['.html', '.htm'],
    declaredMimeTypes: ['text/html'],
    magic: null,
  },
  {
    format: 'application/pdf',
    label: 'PDF',
    extensions: ['.pdf'],
    declaredMimeTypes: ['application/pdf'],
    // "%PDF-" — la cabecera que exige la propia especificación.
    magic: [0x25, 0x50, 0x44, 0x46, 0x2d],
  },
  {
    format:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word',
    extensions: ['.docx'],
    declaredMimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    // Un .docx es un ZIP: "PK\x03\x04". Deliberadamente NO se acepta `.doc` binario ni `.docm`
    // con macros — el primero es otro formato, y el segundo lleva código ejecutable que no
    // tenemos ninguna razón para abrir.
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
] as const;

/** Tope del texto EXTRAÍDO, no del fichero. Un PDF de 5 MB puede rendir muchísimo más texto. */
export const MAX_EXTRACTED_TEXT_LENGTH = 2_000_000;

/**
 * Error que puede LEER una PYME.
 *
 * Estos mensajes no se quedan en los registros: la tubería de ingesta los recoge por documento
 * y acaban en la pantalla de Conocimiento junto al nombre del fichero. Por eso dicen qué ha
 * pasado y qué hacer, y nunca nombran una clase, una librería ni un tipo MIME.
 */
export class DocumentRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentRejectedError';
  }
}

export function acceptedExtensions(): string[] {
  return SUPPORTED_FORMATS.flatMap((entry) => [...entry.extensions]);
}

export function acceptedMimeTypes(): string[] {
  return SUPPORTED_FORMATS.flatMap((entry) => [...entry.declaredMimeTypes]);
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

function startsWith(content: Buffer, magic: readonly number[]): boolean {
  if (content.length < magic.length) return false;
  return magic.every((byte, index) => content[index] === byte);
}

/**
 * Reconoce el formato REAL de lo que se ha subido.
 *
 * El orden importa: primero se comprueba que el formato esté admitido, y solo entonces que el
 * contenido lo respalde. Un fichero cuya firma no corresponde con lo que dice ser se rechaza sin
 * llegar a ningún extractor.
 *
 * Los formatos de texto no tienen firma, así que se aceptan por lo declarado — pero se
 * comprueba que no escondan un binario, porque un `.txt` que empieza por `%PDF-` o por `PK` es
 * un fichero renombrado, no un texto.
 */
export function resolveDocumentFormat(params: {
  filename: string;
  declaredMimeType: string;
  content: Buffer;
}): DocumentFormat {
  const declared = params.declaredMimeType.split(';')[0].trim().toLowerCase();
  const extension = extensionOf(params.filename);

  const byDeclared = SUPPORTED_FORMATS.find((entry) =>
    entry.declaredMimeTypes.includes(declared),
  );
  const byExtension = SUPPORTED_FORMATS.find((entry) =>
    entry.extensions.includes(extension),
  );
  const candidate = byDeclared ?? byExtension;

  if (!candidate) {
    throw new DocumentRejectedError(
      `Este tipo de archivo no se puede leer todavía. Admitimos ${humanFormatList()}.`,
    );
  }

  if (candidate.magic) {
    if (!startsWith(params.content, candidate.magic)) {
      // Dice ser un PDF o un Word y su contenido no lo es. Puede ser un fichero renombrado o
      // uno que se corrompió al copiarse; en ambos casos no debe llegar al extractor.
      throw new DocumentRejectedError(
        `Este archivo dice ser ${candidate.label} pero su contenido no lo es. Puede que se ` +
          `haya renombrado o que esté dañado: revísalo y vuelve a intentarlo.`,
      );
    }
    return candidate.format;
  }

  // Formato de texto: se rechaza si esconde un binario conocido.
  const disguised = SUPPORTED_FORMATS.find(
    (entry) => entry.magic && startsWith(params.content, entry.magic),
  );
  if (disguised) {
    throw new DocumentRejectedError(
      `Este archivo parece un ${disguised.label} con la extensión cambiada. Renómbralo con su ` +
        `extensión correcta y vuelve a subirlo.`,
    );
  }

  return candidate.format;
}

function humanFormatList(): string {
  const labels = [...new Set(SUPPORTED_FORMATS.map((entry) => entry.label))];
  return `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}`;
}

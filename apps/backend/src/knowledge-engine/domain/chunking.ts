import { canonicalizeContent } from './content-canonicalization';
import { createHash } from 'node:crypto';

/**
 * Fragmentación consciente de estructura — KNOWLEDGE_ENGINE_DESIGN.md §11.
 *
 * Estrategia principal: cuando la normalización preserva jerarquía (encabezados, párrafos,
 * listas, tablas), el chunking RESPETA esos límites y conserva metadata de posición
 * jerárquica, que se reutiliza en la cita mostrada al usuario (§14).
 *
 * Estrategia de respaldo: para contenido sin estructura reconocible, fragmentación por
 * tamaño objetivo con solape, para no perder una idea que caiga justo en un corte.
 *
 * Función pura y determinista: el mismo documento produce siempre los mismos fragmentos.
 */

export interface ChunkingSettings {
  /** Tamaño objetivo en caracteres. Ni tan pequeño que pierda contexto, ni tan grande que diluya la precisión (§11). */
  targetSize: number;
  /** Solape entre fragmentos consecutivos de la estrategia de respaldo. Fracción menor del tamaño (§11). */
  overlap: number;
  /** Por debajo de esto, un fragmento se fusiona con el siguiente en vez de quedar suelto. */
  minSize: number;
  /** Tablas y bloques de código por debajo de este tamaño se mantienen atómicos aunque excedan el objetivo (§11). */
  maxAtomicBlockSize: number;
}

export const DEFAULT_CHUNKING_SETTINGS: ChunkingSettings = {
  targetSize: 1200,
  overlap: 150,
  minSize: 120,
  maxAtomicBlockSize: 4000,
};

interface OrganizationSettingsShape {
  knowledgeEngine?: { chunking?: Partial<ChunkingSettings> };
}

export function getChunkingSettings(
  organizationSettings: unknown,
): ChunkingSettings {
  const configured = (
    organizationSettings as OrganizationSettingsShape | null | undefined
  )?.knowledgeEngine?.chunking;

  const merged = { ...DEFAULT_CHUNKING_SETTINGS };
  for (const key of Object.keys(merged) as (keyof ChunkingSettings)[]) {
    const value = configured?.[key];
    if (typeof value === 'number' && value > 0) merged[key] = value;
  }
  // El solape debe ser una fracción menor del tamaño: un solape mayor que el chunk
  // produciría fragmentos que se contienen entre sí y un bucle de avance nulo.
  if (merged.overlap >= merged.targetSize) {
    merged.overlap = DEFAULT_CHUNKING_SETTINGS.overlap;
  }
  return merged;
}

export interface ChunkMetadata {
  /** Encabezado bajo el que aparece el fragmento — se muestra en la cita (§14). */
  heading: string | null;
  /** Ruta jerárquica completa de encabezados, p. ej. ["Política", "Vacaciones"]. */
  headingPath: string[];
  /** Naturaleza del bloque, para poder tratarlo distinto en el ranking. */
  blockKind: 'prose' | 'table' | 'code' | 'list';
  /** Posición en caracteres dentro del documento original: reconstruye la cita exacta. */
  startOffset: number;
  endOffset: number;
  /** Producido por la estrategia de respaldo, no por límites estructurales. */
  fallback: boolean;
}

export interface Chunk {
  index: number;
  content: string;
  contentHash: string;
  metadata: ChunkMetadata;
}

interface StructuralBlock {
  text: string;
  kind: ChunkMetadata['blockKind'];
  headingPath: string[];
  startOffset: number;
}

/** Hash del contenido CANÓNICO del fragmento (§3.12) — misma noción de identidad que el resto del sistema. */
export function hashChunkContent(content: string): string {
  return createHash('sha256')
    .update(canonicalizeContent(content))
    .digest('hex');
}

/**
 * Parte el documento en bloques estructurales, manteniendo la ruta de encabezados vigente.
 * Reconoce encabezados Markdown, tablas, bloques de código y listas — que es lo que la
 * normalización (§4) preserva hoy.
 */
function splitIntoBlocks(text: string): StructuralBlock[] {
  const lines = text.split('\n');
  const blocks: StructuralBlock[] = [];

  let headingPath: string[] = [];
  let buffer: string[] = [];
  let bufferKind: ChunkMetadata['blockKind'] = 'prose';
  let bufferStart = 0;
  let offset = 0;
  let inCodeFence = false;

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content.length > 0) {
      blocks.push({
        text: content,
        kind: bufferKind,
        headingPath: [...headingPath],
        startOffset: bufferStart,
      });
    }
    buffer = [];
    bufferKind = 'prose';
  };

  for (const line of lines) {
    const lineLength = line.length + 1;

    if (/^\s*```/.test(line)) {
      // Un bloque de código es una unidad atómica: no se corta a mitad (§11).
      if (!inCodeFence) {
        flush();
        bufferStart = offset;
        bufferKind = 'code';
      }
      buffer.push(line);
      if (inCodeFence) flush();
      inCodeFence = !inCodeFence;
      offset += lineLength;
      continue;
    }

    if (inCodeFence) {
      buffer.push(line);
      offset += lineLength;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      // La ruta jerárquica se trunca al nivel del nuevo encabezado y se extiende con él.
      headingPath = [...headingPath.slice(0, level - 1)];
      headingPath[level - 1] = heading[2].trim();
      headingPath = headingPath.filter((h) => h !== undefined);
      bufferStart = offset + lineLength;
      offset += lineLength;
      continue;
    }

    const isTableRow = /^\s*\|.*\|\s*$/.test(line);
    const isListItem = /^\s*([-*+]|\d+\.)\s+/.test(line);
    const kind: ChunkMetadata['blockKind'] = isTableRow
      ? 'table'
      : isListItem
        ? 'list'
        : 'prose';

    // Un cambio de naturaleza cierra el bloque: una tabla no se mezcla con la prosa que la
    // precede, para que pueda tratarse como unidad atómica.
    if (buffer.length > 0 && kind !== bufferKind && line.trim().length > 0) {
      flush();
      bufferStart = offset;
    }

    if (buffer.length === 0) bufferStart = offset;
    if (line.trim().length === 0 && bufferKind === 'prose') {
      // Un párrafo en blanco cierra el bloque de prosa: es un límite natural.
      flush();
      bufferStart = offset + lineLength;
    } else {
      bufferKind = kind;
      buffer.push(line);
    }

    offset += lineLength;
  }

  flush();
  return blocks;
}

/** Fragmentación por tamaño con solape — estrategia de respaldo para bloques muy largos (§11). */
function splitOversizedBlock(
  block: StructuralBlock,
  settings: ChunkingSettings,
): { text: string; startOffset: number }[] {
  const pieces: { text: string; startOffset: number }[] = [];
  const step = settings.targetSize - settings.overlap;

  for (let start = 0; start < block.text.length; start += step) {
    const slice = block.text.slice(start, start + settings.targetSize);
    if (slice.trim().length === 0) continue;
    pieces.push({ text: slice, startOffset: block.startOffset + start });
    if (start + settings.targetSize >= block.text.length) break;
  }

  return pieces;
}

export function chunkContent(
  contentText: string,
  settings: ChunkingSettings = DEFAULT_CHUNKING_SETTINGS,
): Chunk[] {
  const blocks = splitIntoBlocks(contentText);
  const chunks: Chunk[] = [];

  let pending: StructuralBlock | null = null;

  const emit = (
    text: string,
    block: StructuralBlock,
    startOffset: number,
    fallback: boolean,
  ) => {
    const content = text.trim();
    if (content.length === 0) return;
    chunks.push({
      index: chunks.length,
      content,
      contentHash: hashChunkContent(content),
      metadata: {
        heading: block.headingPath[block.headingPath.length - 1] ?? null,
        headingPath: block.headingPath,
        blockKind: block.kind,
        startOffset,
        endOffset: startOffset + content.length,
        fallback,
      },
    });
  };

  for (const block of blocks) {
    // Tablas y código se mantienen atómicos aunque excedan el objetivo, porque
    // fragmentarlos rompe su interpretabilidad (§11).
    const isAtomic =
      (block.kind === 'table' || block.kind === 'code') &&
      block.text.length <= settings.maxAtomicBlockSize;

    if (!isAtomic && block.text.length > settings.targetSize) {
      if (pending) {
        emit(pending.text, pending, pending.startOffset, false);
        pending = null;
      }
      for (const piece of splitOversizedBlock(block, settings)) {
        emit(piece.text, block, piece.startOffset, true);
      }
      continue;
    }

    if (pending !== null) {
      const previous: StructuralBlock = pending;
      // Un bloque demasiado pequeño se fusiona con el siguiente, siempre que compartan
      // encabezado: no tiene sentido un fragmento suelto de una línea.
      const sameHeading =
        previous.headingPath.join('>') === block.headingPath.join('>');
      const merged = `${previous.text}\n\n${block.text}`;

      if (sameHeading && merged.length <= settings.targetSize) {
        pending = { ...previous, text: merged };
        continue;
      }
      emit(previous.text, previous, previous.startOffset, false);
      pending = null;
    }

    if (block.text.length < settings.minSize) {
      pending = block;
      continue;
    }

    emit(block.text, block, block.startOffset, false);
  }

  if (pending) emit(pending.text, pending, pending.startOffset, false);

  // Reindexa tras la fusión para que el orden ordinal sea contiguo.
  return chunks.map((chunk, index) => ({ ...chunk, index }));
}

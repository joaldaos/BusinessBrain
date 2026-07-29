/**
 * Context Builder — KNOWLEDGE_ENGINE_DESIGN.md §14.
 *
 * Recibe los fragmentos YA rankeados por el Retriever y los ensambla en un bloque de
 * contexto listo para un prompt. No construye el prompt final: el system prompt del agente
 * y el historial de conversación son responsabilidad de la superficie de consumo.
 *
 * Tres reglas que el diseño fija y que esta función respeta sin excepción:
 *
 * 1. **Preserva el orden de relevancia** que llega del Retriever. El Context Builder no
 *    reordena por su cuenta (§14, "Priorización de conocimiento").
 * 2. **Nunca trunca un fragmento a la mitad.** Si el conjunto excede el presupuesto, se
 *    descartan enteros los de menor rank: un fragmento cortado a mitad de frase es peor que
 *    no incluirlo.
 * 3. **Toda pieza entregada lleva su cita** — documento, posición y encabezado — para que
 *    cualquier respuesta pueda mostrarse con su fuente en vez de como afirmación sin
 *    respaldo.
 *
 * Función pura y determinista.
 */

/** Presupuesto por defecto reservado al conocimiento recuperado, en tokens. */
export const DEFAULT_KNOWLEDGE_TOKEN_BUDGET = 4000;

/**
 * Aproximación de tokens sin dependencia externa. Deliberadamente conservadora: es
 * preferible entregar algo menos de contexto que exceder el presupuesto real del modelo.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface ContextCandidate {
  chunkId: string;
  content: string;
  confidenceScore: number;
  citation: {
    knowledgeItemId: string;
    title: string;
    chunkIndex: number;
    heading: string | null;
    headingPath: string[];
  };
}

export interface ContextPiece extends ContextCandidate {
  /** Posición en el bloque final, empezando en 1: es la referencia que se cita. */
  ordinal: number;
  tokenCount: number;
}

export interface BuiltContext {
  /** Bloque de texto listo para insertarse en un prompt. */
  text: string;
  pieces: ContextPiece[];
  usedTokens: number;
  budget: number;
  /** Fragmentos que no cupieron. Se informa: nunca se descarta en silencio. */
  droppedChunkIds: string[];
}

/**
 * Etiqueta de cita legible por una persona: "Política de Vacaciones › Ausencias".
 * Es lo que permite mostrar "fuente: Política de Vacaciones, sección 2" en vez de una
 * afirmación sin respaldo (§14, "Citar fuentes").
 */
export function citationLabel(citation: ContextCandidate['citation']): string {
  const path = citation.headingPath.filter((h) => h.length > 0);
  return path.length > 0
    ? `${citation.title} › ${path.join(' › ')}`
    : citation.title;
}

export function buildContext(
  candidates: ContextCandidate[],
  budget: number = DEFAULT_KNOWLEDGE_TOKEN_BUDGET,
): BuiltContext {
  const pieces: ContextPiece[] = [];
  const droppedChunkIds: string[] = [];
  let usedTokens = 0;

  for (const candidate of candidates) {
    const header = `[${pieces.length + 1}] ${citationLabel(candidate.citation)} (confianza ${candidate.confidenceScore.toFixed(2)})`;
    const tokenCount = estimateTokens(`${header}\n${candidate.content}`);

    // Se descarta entero, nunca se recorta. Y se sigue evaluando el resto: un fragmento
    // muy largo no debe impedir que entren los siguientes, más pequeños.
    if (usedTokens + tokenCount > budget) {
      droppedChunkIds.push(candidate.chunkId);
      continue;
    }

    usedTokens += tokenCount;
    pieces.push({ ...candidate, ordinal: pieces.length + 1, tokenCount });
  }

  const text = pieces
    .map(
      (piece) =>
        `[${piece.ordinal}] ${citationLabel(piece.citation)} ` +
        `(confianza ${piece.confidenceScore.toFixed(2)})\n${piece.content}`,
    )
    .join('\n\n---\n\n');

  return { text, pieces, usedTokens, budget, droppedChunkIds };
}

/**
 * Directriz de uso del contexto — §14, "Evitar alucinaciones".
 *
 * El Knowledge Engine no construye prompts, pero sí facilita esta instrucción para que la
 * superficie de consumo la incorpore: responder solo a partir del contexto entregado y
 * declarar explícitamente cuándo la información no está disponible, en vez de completar con
 * conocimiento general del modelo.
 *
 * La confianza de cada pieza viaja visible precisamente para que una respuesta apoyada en
 * contenido poco confiable pueda matizarse en vez de presentarse con la misma seguridad
 * que una de alta confianza.
 */
export const GROUNDING_DIRECTIVE = [
  'Responde ÚNICAMENTE a partir del contexto entregado.',
  'Si la información no está en el contexto, dilo explícitamente en vez de completarla con conocimiento general.',
  'Cita las fuentes que uses con su número entre corchetes, por ejemplo [1].',
  'Si el contexto que sostiene tu respuesta tiene confianza baja, mátizalo en vez de afirmarlo con seguridad.',
].join('\n');

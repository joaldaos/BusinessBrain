/**
 * Alcance de conocimiento — KNOWLEDGE_ENGINE_DESIGN.md §535. Subfase 6.3.
 *
 * ## Por qué el alcance deja de ser opcional
 *
 * Hasta aquí `RetrieveContext` y `RetrieveInsights` recibían una lista de colecciones
 * **opcional**: omitirla devolvía todo lo de la organización. La corrección dependía por
 * completo de que cada llamante se acordara de pasarla, y un descuido no produce ningún
 * error visible — produce acceso total, indistinguible del funcionamiento correcto.
 *
 * Peor todavía: en el Retriever, una lista VACÍA se trataba igual que la ausencia de lista.
 * "Este consumidor no tiene ninguna colección concedida" y "este consumidor puede verlo todo"
 * eran el mismo valor. Es exactamente al revés de lo que exige §535: el acceso se concede,
 * nunca se presupone.
 *
 * Con este tipo, omitir el alcance **no compila**, y el acceso a toda la organización deja de
 * ser el resultado de un olvido para convertirse en una declaración explícita con motivo.
 *
 * ## Por qué los motivos son un catálogo cerrado
 *
 * Un `reason: string` libre haría que "toda la organización" fuera tan fácil de declarar como
 * de justificar a posteriori. Con un catálogo, cada uso legítimo es enumerable, buscable y
 * revisable: si alguien necesita uno nuevo, tiene que añadirlo aquí y explicarlo, que es
 * precisamente la conversación que debe ocurrir.
 */

/**
 * Motivos por los que una lectura puede abarcar toda la organización.
 *
 * Hoy solo hay uno, y es el correcto por diseño: el RAZONAMIENTO analiza todo el conocimiento
 * de la empresa (UNDERSTANDING_ENGINE_DESIGN.md §3.4). El alcance por persona se aplica al
 * LEER la comprensión producida, no al producirla — acotar el análisis dejaría a la empresa
 * con conclusiones parciales según quién lanzara la ejecución.
 */
export const ORGANIZATION_WIDE_REASONS = {
  ANALYSIS_REASONING:
    'El razonamiento analiza todo el conocimiento de la organización (§3.4); el alcance ' +
    'por persona se aplica al leer la comprensión, no al producirla',
} as const;

export type OrganizationWideReason =
  (typeof ORGANIZATION_WIDE_REASONS)[keyof typeof ORGANIZATION_WIDE_REASONS];

export type KnowledgeScope =
  /**
   * Acotado a colecciones concretas. Una lista VACÍA significa acceso a NADA, nunca a todo:
   * es la respuesta correcta para quien no tiene ninguna concesión.
   */
  | { mode: 'COLLECTIONS'; collectionIds: string[] }
  /** Toda la organización, declarado y justificado. */
  | { mode: 'ORGANIZATION_WIDE'; reason: OrganizationWideReason };

/** Alcance acotado a las colecciones indicadas. */
export function collectionsScope(collectionIds: string[]): KnowledgeScope {
  return { mode: 'COLLECTIONS', collectionIds: [...new Set(collectionIds)] };
}

/** Alcance de organización completa. Exige declarar el motivo del catálogo. */
export function organizationWideScope(
  reason: OrganizationWideReason,
): KnowledgeScope {
  return { mode: 'ORGANIZATION_WIDE', reason };
}

/**
 * ¿Este alcance no puede devolver nada?
 *
 * Un alcance de colecciones vacío no es un error ni un caso raro: es lo que corresponde a
 * quien no tiene ninguna concesión. Quien consulta debe cortocircuitar y devolver vacío en
 * vez de construir una consulta sin filtro.
 */
export function isEmptyScope(scope: KnowledgeScope): boolean {
  return scope.mode === 'COLLECTIONS' && scope.collectionIds.length === 0;
}

/**
 * Colecciones por las que filtrar, o `null` si la lectura abarca la organización entera.
 *
 * Devolver `null` explícitamente —en vez de una lista vacía— evita el error que motivó todo
 * esto: que "sin colecciones" y "sin filtro" acaben siendo el mismo valor.
 */
export function scopeFilter(scope: KnowledgeScope): string[] | null {
  return scope.mode === 'COLLECTIONS' ? scope.collectionIds : null;
}

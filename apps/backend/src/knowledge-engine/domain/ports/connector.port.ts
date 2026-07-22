/** Contenido crudo extraído por un conector, antes de normalizar (KNOWLEDGE_ENGINE_DESIGN.md §4). */
export interface ExtractedContent {
  title: string;
  mimeType: string;
  sizeBytes: number;
  sourceUrl?: string;
  rawContent: Buffer;
}

/**
 * Puerto que cualquier conector (KNOWLEDGE_ENGINE_DESIGN.md §3.1) debe implementar. Devuelve
 * una lista porque un conector puede producir varios KnowledgeItem candidatos por
 * sincronización (p. ej. una carpeta completa de Drive, en una fase posterior) — el conector
 * de carga manual de esta subfase siempre devuelve exactamente un elemento, pero el contrato
 * no asume eso.
 */
export interface ConnectorPort {
  readonly key: string;
  extract(input: unknown): Promise<ExtractedContent[]>;
}

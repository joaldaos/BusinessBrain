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
  /**
   * Cómo llega el contenido.
   *
   * - `PUSH`: alguien lo entrega en la petición (una subida manual). Sin ese contenido no hay
   *   nada que ingerir, así que la superficie debe exigirlo.
   * - `PULL`: el conector va a buscarlo con lo que declara la fuente (una URL, y en el futuro
   *   una carpeta o un buzón). No hace falta que nadie esté delante — y por eso es la que
   *   permite sincronizar de forma programada.
   *
   * La distinción vive en el puerto y no en la superficie a propósito: si el controlador
   * decidiera por clave de conector, cada conector nuevo obligaría a tocarlo.
   */
  readonly acquisition: 'PUSH' | 'PULL';
  extract(input: unknown): Promise<ExtractedContent[]>;
}

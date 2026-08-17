/** Contenido crudo extraído por un conector, antes de normalizar (KNOWLEDGE_ENGINE_DESIGN.md §4). */
export interface ExtractedContent {
  title: string;
  mimeType: string;
  sizeBytes: number;
  sourceUrl?: string;
  rawContent: Buffer;
  /**
   * Lo que la fuente dijo y NO es conocimiento.
   *
   * Se guarda aparte del contenido a propósito: `rawContent` se normaliza, se trocea, se
   * vectoriza y se recupera; esto sirve para sincronizar, agrupar o trazar y no debe acabar
   * en un embedding ni en un informe. Hoy lo usa Gmail para el hilo y la dirección del
   * remitente — dato personal que por decisión de producto queda fuera del conocimiento
   * recuperable.
   */
  sourceMetadata?: Record<string, unknown>;
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
  /**
   * La fuente exige un perímetro de acceso RESTRINGIDO.
   *
   * Un buzón de correo no es una carpeta compartida: si su contenido aterrizara en una
   * colección accesible para toda la organización, conectarlo convertiría el correo de una
   * persona en conocimiento de empresa sin que nadie lo hubiera decidido.
   *
   * Se declara en el conector y no se comprueba por clave para que la exigencia sea
   * estructural: quien añada otra fuente sensible solo tiene que declararlo, y la
   * comprobación —al crear la fuente Y en cada sincronización— ya existe.
   */
  readonly requiresRestrictedCollection?: boolean;
  extract(input: unknown): Promise<ExtractedContent[]>;
}

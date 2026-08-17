/**
 * Contrato con Gmail.
 *
 * Igual que con Drive: detrás de este puerto vive solo lo que es de Google. El perímetro de
 * colección, la frontera de etiqueta, la separación entre conocimiento y metadata operativa, el
 * recorte del historial citado, la idempotencia y el versionado son lógica NUESTRA, y se
 * verifican sin credenciales ni red.
 */

export const GMAIL_PORT = Symbol('GMAIL_PORT');

export interface GmailLabel {
  id: string;
  name: string;
}

/** Un mensaje tal como lo entrega el adaptador, ya con el cuerpo convertido a texto. */
export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  sentAt: string | null;
  body: string;
  labelIds: string[];
}

/**
 * Resultado de preguntar qué hay o qué cambió en la etiqueta.
 *
 * `historyId` es el marcador de Gmail: guardarlo es lo que convierte la siguiente
 * sincronización en incremental. `expired` avisa de que el marcador es demasiado viejo y hay
 * que caer a una sincronización completa — Gmail no garantiza cuánto tiempo lo conserva, y una
 * fuente pausada dos semanas ya lo provoca.
 */
export interface GmailSyncResult {
  messages: GmailMessage[];
  historyId: string;
  expired: boolean;
}

export interface GmailPort {
  buildAuthorizationUrl(params: { state: string; redirectUri: string }): string;

  exchangeCode(params: {
    code: string;
    redirectUri: string;
  }): Promise<import('./google-drive.port').GoogleTokens>;

  /**
   * Dirección del buzón conectado.
   *
   * Es identidad de la CONEXIÓN, no contenido: se muestra para que un administrador sepa qué
   * buzón alimenta al sistema. No se indexa ni se recupera — al contrario que la dirección del
   * remitente de un mensaje, que queda deliberadamente fuera del conocimiento.
   */
  accountEmail(params: { accessToken: string }): Promise<string | null>;

  listLabels(params: { accessToken: string }): Promise<GmailLabel[]>;

  /**
   * Mensajes de la etiqueta.
   *
   * Sin `historyId` es la sincronización completa —la primera vez, o cuando el marcador
   * caducó—. Con él, solo lo que cambió desde entonces.
   */
  listMessages(params: {
    accessToken: string;
    labelId: string;
    historyId?: string;
  }): Promise<GmailSyncResult>;

  /**
   * Identificadores de lo que hay AHORA en la etiqueta.
   *
   * Necesario para detectar lo que ha dejado de pertenecer a ella sin renunciar al
   * incremental: un listado incremental nunca contiene lo que ha desaparecido.
   */
  listPresentMessageIds(params: {
    accessToken: string;
    labelId: string;
  }): Promise<string[]>;
}

/**
 * Contrato con Google Drive.
 *
 * Existe para que **todo lo que hay por encima sea verificable sin credenciales de Google**:
 * el flujo de conexión, la selección de carpeta, la sincronización incremental, el versionado
 * y la revocación son lógica nuestra, y probarla no debería depender de una cuenta real ni de
 * que la red esté disponible en CI.
 *
 * Detrás de este puerto vive lo único que sí es de Google: intercambiar un código por tokens,
 * refrescarlos, listar y descargar. Nada más.
 */

export const GOOGLE_DRIVE_PORT = Symbol('GOOGLE_DRIVE_PORT');

export interface GoogleTokens {
  accessToken: string;
  /** Google solo lo entrega la PRIMERA vez que se autoriza, salvo consentimiento forzado. */
  refreshToken?: string;
  expiresAt: Date;
  scope: string;
}

export interface DriveFolder {
  id: string;
  name: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** Cambia con cada edición. Es lo que permite saber si un documento se modificó. */
  modifiedTime: string;
  sizeBytes: number;
}

/**
 * Resultado de preguntar qué hay o qué cambió.
 *
 * `cursor` es el marcador que Google devuelve para continuar: guardarlo es lo que convierte
 * la siguiente sincronización en incremental. `removedFileIds` viaja aparte porque un archivo
 * que desaparece NO es un archivo con contenido nuevo, y confundirlos llevaría a ingerir
 * vacíos.
 */
export interface DriveListing {
  files: DriveFile[];
  removedFileIds: string[];
  cursor: string;
}

export interface GoogleDrivePort {
  /** URL a la que se envía a la persona para que autorice. */
  buildAuthorizationUrl(params: { state: string; redirectUri: string }): string;

  exchangeCode(params: {
    code: string;
    redirectUri: string;
  }): Promise<GoogleTokens>;

  refreshTokens(refreshToken: string): Promise<GoogleTokens>;

  /** Invalida el consentimiento en Google, no solo en nuestra base de datos. */
  revoke(token: string): Promise<void>;

  listFolders(params: { accessToken: string }): Promise<DriveFolder[]>;

  /**
   * Qué hay en la carpeta.
   *
   * Sin `cursor` es un listado completo — la primera vez. Con `cursor`, solo lo que cambió
   * desde entonces.
   */
  listFiles(params: {
    accessToken: string;
    folderId: string;
    cursor?: string;
  }): Promise<DriveListing>;

  /** Texto del documento. Google Docs se exporta; los ficheros de texto se descargan. */
  downloadText(params: {
    accessToken: string;
    file: DriveFile;
  }): Promise<string>;
}

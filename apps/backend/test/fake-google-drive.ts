import type {
  DriveFile,
  DriveFolder,
  DriveListing,
  GoogleDrivePort,
  GoogleTokens,
} from '../src/integrations/domain/ports/google-drive.port';

/**
 * Google Drive sustituible.
 *
 * Es la razón de que `GoogleDrivePort` exista: todo lo que hay por encima —conexión,
 * selección de carpeta, sincronización incremental, versionado, revocación— es lógica nuestra
 * y debe poder verificarse sin una cuenta real ni red en CI.
 *
 * Guarda documentos en memoria con su fecha de modificación, para poder demostrar de verdad
 * que la segunda sincronización solo trae lo que cambió.
 */
export class FakeGoogleDrive implements GoogleDrivePort {
  readonly folders: DriveFolder[] = [{ id: 'folder-1', name: 'Políticas' }];

  /** Documentos por carpeta. La clave es el identificador del fichero. */
  private readonly files = new Map<
    string,
    { file: DriveFile; folderId: string; text: string }
  >();

  /** Qué se le ha pedido a "Google". Permite afirmar que el incremental lo es de verdad. */
  readonly calls: { listFiles: { cursor?: string }[] } = { listFiles: [] };

  refreshShouldFail = false;
  revoked: string[] = [];

  putFile(params: {
    id: string;
    name: string;
    text: string;
    modifiedTime: string;
    folderId?: string;
    mimeType?: string;
  }): void {
    this.files.set(params.id, {
      folderId: params.folderId ?? 'folder-1',
      text: params.text,
      file: {
        id: params.id,
        name: params.name,
        mimeType: params.mimeType ?? 'application/vnd.google-apps.document',
        modifiedTime: params.modifiedTime,
        sizeBytes: Buffer.byteLength(params.text),
      },
    });
  }

  removeFile(id: string): void {
    this.files.delete(id);
  }

  buildAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
  }): string {
    return `https://accounts.google.test/authorize?state=${encodeURIComponent(params.state)}&redirect_uri=${encodeURIComponent(params.redirectUri)}`;
  }

  exchangeCode(params: { code: string }): Promise<GoogleTokens> {
    if (params.code === 'codigo-invalido') {
      return Promise.reject(new Error('invalid_grant'));
    }
    return Promise.resolve({
      accessToken: `acceso-${params.code}`,
      refreshToken: `refresco-${params.code}`,
      expiresAt: new Date(Date.now() + 3_600_000),
      scope:
        params.code === 'codigo-sin-permisos'
          ? 'openid email'
          : 'https://www.googleapis.com/auth/drive.readonly',
    });
  }

  refreshTokens(refreshToken: string): Promise<GoogleTokens> {
    if (this.refreshShouldFail) {
      return Promise.reject(new Error('invalid_grant'));
    }
    return Promise.resolve({
      accessToken: `acceso-renovado-${refreshToken}`,
      expiresAt: new Date(Date.now() + 3_600_000),
      scope: 'https://www.googleapis.com/auth/drive.readonly',
    });
  }

  revoke(token: string): Promise<void> {
    this.revoked.push(token);
    return Promise.resolve();
  }

  listFolders(): Promise<DriveFolder[]> {
    return Promise.resolve(this.folders);
  }

  listFiles(params: {
    accessToken: string;
    folderId: string;
    cursor?: string;
  }): Promise<DriveListing> {
    this.calls.listFiles.push({ cursor: params.cursor });

    const inFolder = [...this.files.values()].filter(
      (entry) => entry.folderId === params.folderId,
    );
    // Incremental de verdad: solo lo modificado DESPUÉS del marcador, igual que hace Drive.
    const changed = inFolder.filter(
      (entry) => !params.cursor || entry.file.modifiedTime > params.cursor,
    );

    const cursor = inFolder.reduce(
      (max, entry) =>
        entry.file.modifiedTime > max ? entry.file.modifiedTime : max,
      params.cursor ?? '1970-01-01T00:00:00.000Z',
    );

    return Promise.resolve({
      files: changed.map((entry) => entry.file),
      removedFileIds: [],
      cursor,
    });
  }

  listPresentFileIds(params: {
    accessToken: string;
    folderId: string;
  }): Promise<string[]> {
    return Promise.resolve(
      [...this.files.values()]
        .filter((entry) => entry.folderId === params.folderId)
        .map((entry) => entry.file.id),
    );
  }

  downloadText(params: { file: DriveFile }): Promise<string> {
    const entry = this.files.get(params.file.id);
    if (!entry) return Promise.reject(new Error('no existe'));
    return Promise.resolve(entry.text);
  }
}

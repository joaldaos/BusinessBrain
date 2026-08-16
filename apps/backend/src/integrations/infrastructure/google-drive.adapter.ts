import { Injectable, Logger } from '@nestjs/common';
import type {
  DriveFile,
  DriveFolder,
  DriveListing,
  GoogleDrivePort,
  GoogleTokens,
} from '../domain/ports/google-drive.port';

const OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

/** Formatos de Google que hay que EXPORTAR para obtener texto; no se descargan tal cual. */
const EXPORTABLE: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
};

/**
 * Lo único que es de Google.
 *
 * Todo lo demás —el flujo de conexión, la selección de carpeta, la sincronización incremental,
 * el versionado, la revocación— es lógica nuestra y vive por encima del puerto, verificable
 * sin credenciales. Aquí solo hay llamadas HTTP a su API.
 *
 * Las credenciales se leen del entorno y **no se validan al arrancar**: una organización que
 * no use Drive no debería impedir que el sistema arranque. Se comprueba al usarlas, con un
 * mensaje que dice exactamente qué falta.
 */
@Injectable()
export class GoogleDriveAdapter implements GoogleDrivePort {
  private readonly logger = new Logger(GoogleDriveAdapter.name);

  buildAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
  }): string {
    const query = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      // Sin `offline` Google no entrega token de refresco y la conexión moriría en una hora.
      access_type: 'offline',
      // Fuerza la pantalla de consentimiento: es la única forma de recuperar el token de
      // refresco si el usuario ya había autorizado antes y nosotros lo perdimos.
      prompt: 'consent',
      state: params.state,
      include_granted_scopes: 'true',
    });

    return `${OAUTH_BASE}?${query.toString()}`;
  }

  async exchangeCode(params: {
    code: string;
    redirectUri: string;
  }): Promise<GoogleTokens> {
    return this.requestTokens({
      code: params.code,
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    });
  }

  async refreshTokens(refreshToken: string): Promise<GoogleTokens> {
    return this.requestTokens({
      refresh_token: refreshToken,
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      grant_type: 'refresh_token',
    });
  }

  async revoke(token: string): Promise<void> {
    const response = await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });

    if (!response.ok) {
      throw new Error(`Google devolvió ${response.status} al revocar`);
    }
  }

  async listFolders(params: { accessToken: string }): Promise<DriveFolder[]> {
    const query = new URLSearchParams({
      q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: 'files(id,name)',
      pageSize: '100',
      orderBy: 'name',
    });

    const body = await this.get<{ files?: DriveFolder[] }>(
      `${DRIVE_API}/files?${query.toString()}`,
      params.accessToken,
    );

    return body.files ?? [];
  }

  /**
   * Qué hay o qué cambió en la carpeta.
   *
   * Se usa `modifiedTime` como marcador y no la API de cambios de Google: esa API es de la
   * unidad ENTERA, no de una carpeta, y devolvería movimiento de documentos que la
   * organización no ha elegido sincronizar. Preguntar por la carpeta con un umbral de fecha es
   * más estrecho y no requiere permisos adicionales.
   */
  async listFiles(params: {
    accessToken: string;
    folderId: string;
    cursor?: string;
  }): Promise<DriveListing> {
    const conditions = [
      `'${params.folderId}' in parents`,
      'trashed = false',
      ...(params.cursor ? [`modifiedTime > '${params.cursor}'`] : []),
    ];

    const query = new URLSearchParams({
      q: conditions.join(' and '),
      fields: 'files(id,name,mimeType,modifiedTime,size)',
      pageSize: '200',
      orderBy: 'modifiedTime',
    });

    const body = await this.get<{
      files?: (DriveFile & { size?: string })[];
    }>(`${DRIVE_API}/files?${query.toString()}`, params.accessToken);

    const files = (body.files ?? []).map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime,
      sizeBytes: Number(file.size ?? 0),
    }));

    // El marcador nuevo es la fecha más reciente vista; si no vino nada, se conserva el
    // anterior. Avanzarlo a "ahora" perdería los cambios ocurridos durante la ejecución.
    const latest = files.reduce(
      (max, file) => (file.modifiedTime > max ? file.modifiedTime : max),
      params.cursor ?? '1970-01-01T00:00:00.000Z',
    );

    return {
      files,
      // Las desapariciones NO se deducen de este listado: es incremental y solo trae lo
      // cambiado. Quien las detecta es `listPresentFileIds`, comparando lo que hay ahora
      // contra lo que nosotros tenemos.
      removedFileIds: [],
      cursor: latest,
    };
  }

  /**
   * Solo identificadores: `fields` limitado a `files(id)`.
   *
   * Es lo que permite detectar desapariciones sin renunciar al incremental — la alternativa
   * seria pedir el listado completo con metadatos en cada sincronizacion.
   */
  async listPresentFileIds(params: {
    accessToken: string;
    folderId: string;
  }): Promise<string[]> {
    const query = new URLSearchParams({
      q: `'${params.folderId}' in parents and trashed = false`,
      fields: 'files(id)',
      pageSize: '1000',
    });

    const body = await this.get<{ files?: { id: string }[] }>(
      `${DRIVE_API}/files?${query.toString()}`,
      params.accessToken,
    );

    return (body.files ?? []).map((file) => file.id);
  }

  async downloadText(params: {
    accessToken: string;
    file: DriveFile;
  }): Promise<string> {
    const exportMime = EXPORTABLE[params.file.mimeType];

    const url = exportMime
      ? `${DRIVE_API}/files/${params.file.id}/export?mimeType=${encodeURIComponent(exportMime)}`
      : `${DRIVE_API}/files/${params.file.id}?alt=media`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Google devolvió ${response.status} al descargar`);
    }

    return response.text();
  }

  private async requestTokens(
    body: Record<string, string>,
  ): Promise<GoogleTokens> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });

    if (!response.ok) {
      throw new Error(
        `Google devolvió ${response.status} al pedir tokens: ${await response.text()}`,
      );
    }

    const payload = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: new Date(Date.now() + payload.expires_in * 1000),
      scope: payload.scope,
    };
  }

  private async get<T>(url: string, accessToken: string): Promise<T> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(
        `Google devolvió ${response.status}: ${await response.text()}`,
      );
    }

    return (await response.json()) as T;
  }

  private clientId(): string {
    return this.required('GOOGLE_CLIENT_ID');
  }

  private clientSecret(): string {
    return this.required('GOOGLE_CLIENT_SECRET');
  }

  private required(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(
        `Falta ${name}: la integración con Google Drive no está configurada en este ` +
          `despliegue`,
      );
    }
    return value;
  }
}

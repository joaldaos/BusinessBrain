import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type {
  ConnectorPort,
  ExtractedContent,
} from '../../knowledge-engine/domain/ports/connector.port';
import {
  GOOGLE_DRIVE_PORT,
  type DriveFile,
  type GoogleDrivePort,
} from '../domain/ports/google-drive.port';
import { IntegrationsService } from '../application/integrations.service';

/** Config que declara una `KnowledgeSource` de Drive. Se cifra en reposo. */
export interface GoogleDriveConnectorConfig {
  integrationId: string;
  folderId: string;
  folderName?: string;
}

export interface GoogleDriveConnectorInput {
  config?: Record<string, unknown>;
  organizationId?: string;
  /** Marcador de dónde se quedó la última sincronización. Ausente = primera vez. */
  cursor?: string;
  /** Devuelve el marcador nuevo para que la ingesta lo guarde. */
  onCursor?: (cursor: string) => void;
  /**
   * Qué sigue existiendo en el origen, por su `sourceUrl`.
   *
   * Se informa lo PRESENTE y no lo ausente a propósito: el conector sabe qué hay en la
   * carpeta, pero no qué tiene BusinessBrain. Comparar es cosa de la ingesta, que es quien
   * conoce ambos lados — y así la desaparición y la reaparición salen del mismo dato.
   */
  onPresentAtSource?: (sourceUrls: string[]) => void;
}

/** Tope de documentos por sincronización: un Drive grande no puede agotar una ejecución. */
const MAX_FILES_PER_SYNC = 200;
/** Sin un mínimo de texto no hay nada que comprender, y sí basura que indexar. */
const MIN_TEXT_LENGTH = 40;

/**
 * Conector de Google Drive — segunda integración externa, la primera con OAuth.
 *
 * Es un conector `PULL`, igual que el de página web: nadie sube nada, el servidor va a
 * buscarlo con lo que declara la fuente. Por eso puede ejecutarse sin persona delante y
 * programarse con `SYNC_KNOWLEDGE_SOURCE`.
 *
 * ## Sincronización incremental
 *
 * La primera vez trae la carpeta entera. Después, solo lo que Google dice que ha cambiado
 * desde el marcador guardado. No es una optimización: sin ella, cada sincronización nocturna
 * descargaría el Drive completo de cada cliente.
 *
 * El marcador lo devuelve Google y lo guarda la ingesta en la fuente. Va **fuera** de
 * `configEnc` porque no es un secreto —no da acceso a nada— y meterlo ahí obligaría a
 * descifrar y recifrar la configuración entera en cada ejecución.
 *
 * ## La idempotencia y el versionado no los pone este conector
 *
 * Los pone la tubería que ya existe, igual que con el conector web: el mismo contenido produce
 * el mismo `contentHash` y se reconoce como duplicado exacto; un documento editado se parece
 * lo bastante al anterior y nace como versión nueva con su arista `UPDATES`, sin que el
 * anterior se sobrescriba. Google puede decir "esto cambió" por motivos que no alteran el
 * texto —un renombrado, un permiso— y en ese caso no se crea nada: eso es correcto y es
 * exactamente por qué la decisión no se toma aquí.
 */
@Injectable()
export class GoogleDriveConnector implements ConnectorPort {
  private readonly logger = new Logger(GoogleDriveConnector.name);

  readonly key = 'google_drive_v1';
  readonly acquisition = 'PULL' as const;

  constructor(
    @Inject(GOOGLE_DRIVE_PORT) private readonly drive: GoogleDrivePort,
    private readonly integrations: IntegrationsService,
  ) {}

  async extract(input: GoogleDriveConnectorInput): Promise<ExtractedContent[]> {
    const { integrationId, folderId } = this.readConfig(input);

    if (!input.organizationId) {
      // Sin organización no se puede resolver la conexión, y resolverla sin ella permitiría
      // usar la de otro tenant. Falla cerrado.
      throw new BadRequestException(
        'No se pudo resolver la organización de la sincronización',
      );
    }

    // Aquí es donde una conexión revocada detiene la sincronización: `accessTokenFor` no
    // entrega token si la conexión no está activa.
    const accessToken = await this.integrations.accessTokenFor({
      organizationId: input.organizationId,
      integrationId,
    });

    const listing = await this.drive.listFiles({
      accessToken,
      folderId,
      cursor: input.cursor,
    });

    input.onCursor?.(listing.cursor);

    // Consulta aparte y barata: solo identificadores. El listado incremental no sirve para
    // esto porque solo trae lo cambiado, y lo que ha desaparecido nunca aparece en él.
    if (input.onPresentAtSource) {
      const presentIds = await this.drive.listPresentFileIds({
        accessToken,
        folderId,
      });
      input.onPresentAtSource(presentIds.map((id) => this.sourceUrlOf(id)));
    }

    const files = listing.files.slice(0, MAX_FILES_PER_SYNC);
    if (listing.files.length > MAX_FILES_PER_SYNC) {
      this.logger.warn(
        `La carpeta ${folderId} devolvió ${listing.files.length} documentos; se procesan ` +
          `los primeros ${MAX_FILES_PER_SYNC} y el resto llegará en la siguiente ` +
          `sincronización`,
      );
    }

    const extracted: ExtractedContent[] = [];
    for (const file of files) {
      const content = await this.extractOne(accessToken, file);
      if (content) extracted.push(content);
    }

    return extracted;
  }

  /**
   * Un documento.
   *
   * Un fallo individual no tumba la sincronización entera: un Drive real tiene ficheros
   * corruptos, vídeos y hojas de cálculo. Se registra y se sigue — lo contrario dejaría a una
   * empresa sin poder ingerir nada por culpa de un único archivo.
   */
  private async extractOne(
    accessToken: string,
    file: DriveFile,
  ): Promise<ExtractedContent | null> {
    try {
      const text = await this.drive.downloadText({ accessToken, file });

      if (text.trim().length < MIN_TEXT_LENGTH) {
        this.logger.debug(
          `"${file.name}" no aporta texto suficiente y se omite`,
        );
        return null;
      }

      const rawContent = Buffer.from(text, 'utf8');

      return {
        title: file.name,
        mimeType: 'text/plain',
        sizeBytes: rawContent.byteLength,
        // Enlace citable al documento real: es lo que permite a una persona ir a comprobarlo.
        sourceUrl: this.sourceUrlOf(file.id),
        rawContent,
      };
    } catch (error) {
      this.logger.warn(
        `No se pudo leer "${file.name}" (${file.id}): ${(error as Error).message}`,
      );
      return null;
    }
  }

  /** Enlace citable, y a la vez la identidad estable del documento en su origen. */
  private sourceUrlOf(fileId: string): string {
    return `https://drive.google.com/file/d/${fileId}/view`;
  }

  private readConfig(input: GoogleDriveConnectorInput): {
    integrationId: string;
    folderId: string;
  } {
    const integrationId = input?.config?.integrationId;
    const folderId = input?.config?.folderId;

    if (typeof integrationId !== 'string' || integrationId.length === 0) {
      throw new BadRequestException(
        'Esta fuente no está asociada a ninguna conexión de Google',
      );
    }
    if (typeof folderId !== 'string' || folderId.length === 0) {
      throw new BadRequestException(
        'Esta fuente no tiene ninguna carpeta de Drive configurada',
      );
    }

    return { integrationId, folderId };
  }
}

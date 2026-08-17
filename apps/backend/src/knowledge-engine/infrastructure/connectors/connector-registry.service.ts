import { Injectable } from '@nestjs/common';
import type { ConnectorPort } from '../../domain/ports/connector.port';
import { FileUploadConnector } from './file-upload.connector';
import { WebPageConnector } from './web-page.connector';
import { GoogleDriveConnector } from '../../../integrations/infrastructure/google-drive.connector';
import { GmailConnector } from '../../../integrations/infrastructure/gmail.connector';

/**
 * Único punto del sistema que sabe qué conectores concretos existen (mismo patrón que
 * `ProviderRegistry` en `LlmModule`). `KnowledgeSource.connectorKey` es la clave de búsqueda —
 * ningún consumidor instancia un conector directamente.
 */
@Injectable()
export class ConnectorRegistry {
  private readonly connectors: Record<string, ConnectorPort>;

  constructor(
    fileUploadConnector: FileUploadConnector,
    webPageConnector: WebPageConnector,
    googleDriveConnector: GoogleDriveConnector,
    gmailConnector: GmailConnector,
  ) {
    this.connectors = {
      [fileUploadConnector.key]: fileUploadConnector,
      [webPageConnector.key]: webPageConnector,
      [googleDriveConnector.key]: googleDriveConnector,
      [gmailConnector.key]: gmailConnector,
    };
  }

  /** Claves soportadas. La superficie las ofrece en vez de codificarlas. */
  keys(): string[] {
    return Object.keys(this.connectors);
  }

  get(connectorKey: string): ConnectorPort {
    const connector = this.connectors[connectorKey];
    if (!connector) {
      throw new Error(
        `Conector "${connectorKey}" no implementado todavía (soportados: ${Object.keys(this.connectors).join(', ')})`,
      );
    }
    return connector;
  }
}

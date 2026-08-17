import { ConnectorRegistry } from './connector-registry.service';
import { FileUploadConnector } from './file-upload.connector';
import { WebPageConnector } from './web-page.connector';
import type { GoogleDriveConnector } from '../../../integrations/infrastructure/google-drive.connector';
import type { GmailConnector } from '../../../integrations/infrastructure/gmail.connector';

describe('ConnectorRegistry', () => {
  let registry: ConnectorRegistry;

  beforeEach(() => {
    registry = new ConnectorRegistry(
      new FileUploadConnector(),
      new WebPageConnector(),
      {
        key: 'google_drive_v1',
        acquisition: 'PULL',
      } as unknown as GoogleDriveConnector,
      {
        key: 'gmail_v1',
        acquisition: 'PULL',
        requiresRestrictedCollection: true,
      } as unknown as GmailConnector,
    );
  });

  it('resuelve un conector registrado por su connectorKey', () => {
    const connector = registry.get('file_upload_v1');
    expect(connector.key).toBe('file_upload_v1');
  });

  it('resuelve los conectores que TRAEN su contenido', () => {
    // La distinción `PUSH`/`PULL` es la que decide si una fuente puede sincronizarse sola.
    expect(registry.get('web_page_v1').acquisition).toBe('PULL');
    expect(registry.get('google_drive_v1').acquisition).toBe('PULL');
    expect(registry.get('gmail_v1').acquisition).toBe('PULL');
    expect(registry.get('file_upload_v1').acquisition).toBe('PUSH');
  });

  it('dice qué conectores exigen un perímetro de acceso restringido', () => {
    // Lo consulta el perímetro para decidir si exigirlo: un buzón sí, una carpeta compartida
    // no. Que la respuesta salga del conector, y no de una lista de claves, es lo que hace que
    // añadir otra fuente sensible baste con declararlo.
    expect(registry.get('gmail_v1').requiresRestrictedCollection).toBe(true);
    expect(
      registry.get('google_drive_v1').requiresRestrictedCollection,
    ).toBeFalsy();
    expect(
      registry.get('file_upload_v1').requiresRestrictedCollection,
    ).toBeFalsy();
  });

  it('lanza un error legible para un connectorKey no implementado todavía', () => {
    expect(() => registry.get('whatsapp_v1')).toThrow(
      /no implementado todavía/,
    );
  });
});

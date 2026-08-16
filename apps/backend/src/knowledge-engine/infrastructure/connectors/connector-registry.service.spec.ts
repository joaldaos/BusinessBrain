import { ConnectorRegistry } from './connector-registry.service';
import { FileUploadConnector } from './file-upload.connector';
import { WebPageConnector } from './web-page.connector';
import type { GoogleDriveConnector } from '../../../integrations/infrastructure/google-drive.connector';

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
    expect(registry.get('file_upload_v1').acquisition).toBe('PUSH');
  });

  it('lanza un error legible para un connectorKey no implementado todavía', () => {
    expect(() => registry.get('gmail_v1')).toThrow(/no implementado todavía/);
  });
});

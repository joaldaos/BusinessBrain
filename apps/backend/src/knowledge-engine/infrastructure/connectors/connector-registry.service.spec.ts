import { ConnectorRegistry } from './connector-registry.service';
import { FileUploadConnector } from './file-upload.connector';
import { WebPageConnector } from './web-page.connector';

describe('ConnectorRegistry', () => {
  let registry: ConnectorRegistry;

  beforeEach(() => {
    registry = new ConnectorRegistry(
      new FileUploadConnector(),
      new WebPageConnector(),
    );
  });

  it('resuelve un conector registrado por su connectorKey', () => {
    const connector = registry.get('file_upload_v1');
    expect(connector.key).toBe('file_upload_v1');
  });

  it('lanza un error legible para un connectorKey no implementado todavía', () => {
    expect(() => registry.get('google_drive_v1')).toThrow(
      /no implementado todavía/,
    );
  });
});

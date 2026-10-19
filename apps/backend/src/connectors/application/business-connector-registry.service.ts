import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  BUSINESS_CONNECTOR,
  type BusinessConnectorPort,
} from '../domain/ports/business-connector.port';

/**
 * Único punto del sistema que sabe qué conectores de hechos existen.
 *
 * Mismo patrón que `ConnectorRegistry` y `ProviderRegistry`. Nadie instancia un conector
 * directamente: `OrganizationConnector.connectorKey` es la clave de búsqueda.
 *
 * Es lo que mantiene el núcleo universal — ninguna otra pieza del sistema menciona a un
 * proveedor por su nombre.
 */
@Injectable()
export class BusinessConnectorRegistry {
  private readonly connectors = new Map<string, BusinessConnectorPort>();

  constructor(
    @Optional()
    @Inject(BUSINESS_CONNECTOR)
    connectors: BusinessConnectorPort[] | BusinessConnectorPort | null,
  ) {
    for (const connector of normalizar(connectors)) {
      if (this.connectors.has(connector.key)) {
        throw new Error(
          `Hay dos conectores declarados con la clave "${connector.key}". ` +
            `La clave decide qué implementación atiende a una empresa: no puede haber duda.`,
        );
      }
      this.connectors.set(connector.key, connector);
    }
  }

  /** Las claves soportadas. La superficie las ofrece en vez de codificarlas. */
  keys(): string[] {
    return [...this.connectors.keys()];
  }

  all(): BusinessConnectorPort[] {
    return [...this.connectors.values()];
  }

  /**
   * `null` en vez de excepción: quien consulta a menudo está leyendo una fila antigua cuyo
   * conector ya no existe, y eso debe poder contarse en la pantalla, no reventar.
   */
  find(key: string): BusinessConnectorPort | null {
    return this.connectors.get(key) ?? null;
  }

  /** Cuando no tenerlo es un fallo de programación y no un dato viejo. */
  get(key: string): BusinessConnectorPort {
    const connector = this.find(key);
    if (!connector) {
      throw new NotFoundException(
        `El conector "${key}" no existe. Disponibles: ${this.keys().join(', ') || 'ninguno'}`,
      );
    }
    return connector;
  }
}

function normalizar(
  connectors:
    BusinessConnectorPort[] | BusinessConnectorPort | null | undefined,
): BusinessConnectorPort[] {
  if (!connectors) return [];
  return Array.isArray(connectors) ? connectors : [connectors];
}

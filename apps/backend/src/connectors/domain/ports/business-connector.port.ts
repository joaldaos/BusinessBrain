import type {
  BusinessEntityKind,
  BusinessEventKind,
  ConnectorAuthKind,
} from '@businessbrain/database';
import type { NormalizedBatch } from '../../../business-facts/domain/normalized-batch';

/**
 * Lo que cualquier conector de hechos debe implementar.
 *
 * Gemelo de `ConnectorPort` para la otra vía. Aquel entrega documentos —`rawContent`, que
 * se trocea y se vectoriza—; este entrega hechos ya normalizados, que se agregan y se
 * restan. Son dos contratos distintos porque son dos clases de información distintas, y
 * mezclarlos haría imposible calcular una media.
 */

/**
 * Qué sabe hacer un conector CONCRETO conectado a una empresa CONCRETA.
 *
 * Es la pieza que hace honesto al producto: **una métrica cuyo dato de entrada no está
 * declarado no se calcula, no se enseña y no se estima.** Si el TPV no entrega la hora de
 * «plato listo», la pantalla de tiempos de cocina no existe — y la de integraciones lo dice
 * ANTES de conectar, no después.
 *
 * Es la misma regla que ya aplica `narrarConclusion` cuando le falta un hecho: cuando no se
 * sabe, no se inventa.
 */
export interface ConnectorCapabilities {
  /** Qué maestros sabe traer. */
  entities: BusinessEntityKind[];
  /** Qué hechos sabe traer. Lo que no esté aquí, este conector no lo produce jamás. */
  events: BusinessEventKind[];
  /** Cómo llega la información. */
  delivery: 'WEBHOOK' | 'POLL' | 'BOTH';
  /** ¿Puede recuperar histórico anterior a la conexión? */
  backfill: boolean;
}

/** Cómo se identifica el conector frente al proveedor. */
export interface ConnectorIdentity {
  authKind: ConnectorAuthKind;
  /** Permisos que pedirá, en lenguaje de persona. Se enseñan antes de conectar. */
  scopesDescription: string[];
}

/** Lo que un conector recibe para trabajar. Nunca más de lo que necesita. */
export interface ConnectorContext {
  organizationId: string;
  connectorId: string;
  /**
   * Credencial ya descifrada, viva solo durante la llamada. **No se guarda, no se registra
   * y no se devuelve**: quien la recibe la usa y la suelta.
   */
  secret: unknown;
  /** Configuración no secreta: qué local, qué buzón, qué carpeta. */
  config: Record<string, unknown>;
}

export interface ConnectorHealth {
  ok: boolean;
  /** Qué ocurre, en lenguaje de persona. Nunca un código ni un cuerpo HTTP. */
  detail?: string;
}

export interface BusinessConnectorPort {
  /** Clave estable, p. ej. "square_v1". Versionada: cambiar de contrato no rompe lo vivo. */
  readonly key: string;
  /** Nombre con el que se enseña. */
  readonly displayName: string;
  readonly identity: ConnectorIdentity;
  readonly capabilities: ConnectorCapabilities;

  /**
   * Describe qué parte del sistema externo se sincroniza, en texto legible.
   *
   * Vive AQUÍ y no en un `switch` del núcleo. Antes
   * (`knowledge-sources.service.ts`) había una lista blanca por clave de conector dentro de
   * un servicio del core: bien razonada —es lista blanca justamente para que la config, que
   * puede llevar secretos, no se vuelque entera— pero con diez conectores es inmanejable.
   *
   * Sigue siendo lista blanca: cada conector expone solo lo suyo, y lo que no declare no se
   * cuenta.
   */
  describeScope(config: Record<string, unknown>): string | null;

  /** Trae lo nuevo desde el marcador. Debe ser seguro llamarlo dos veces. */
  pull(ctx: ConnectorContext, cursor: unknown): Promise<NormalizedBatch>;

  /** Normaliza un envío entrante **ya verificado**. Verificar la firma no es cosa suya. */
  receive?(ctx: ConnectorContext, payload: unknown): Promise<NormalizedBatch>;

  /** ¿Sigue viva la conexión? Sin efectos secundarios. */
  health(ctx: ConnectorContext): Promise<ConnectorHealth>;
}

export const BUSINESS_CONNECTOR = Symbol('BUSINESS_CONNECTOR');

/**
 * ¿Puede este conector producir este hecho?
 *
 * Se consulta antes de ofrecer una métrica. Está en el dominio porque es una regla de
 * producto —qué se le promete a una empresa— y no un detalle de ningún proveedor.
 */
export function declaresEvent(
  capabilities: ConnectorCapabilities,
  kind: BusinessEventKind,
): boolean {
  return capabilities.events.includes(kind);
}

/**
 * ¿Están TODOS los hechos que una métrica necesita?
 *
 * Todos, no algunos: un tiempo de preparación con la hora de entrada pero sin la de salida
 * no es una media peor, es una media imposible.
 */
export function canComputeMetric(
  capabilities: ConnectorCapabilities,
  required: BusinessEventKind[],
): boolean {
  return required.every((kind) => declaresEvent(capabilities, kind));
}

import type {
  BusinessEntityKind,
  BusinessEventKind,
} from '@businessbrain/database';

/**
 * Lo que un conector entrega después de normalizar, y antes de que nada se escriba.
 *
 * Es la frontera de la arquitectura: **a partir de aquí no existe ningún proveedor.** El
 * nombre de un campo de un TPV concreto vive dentro de su conector y muere ahí; lo que
 * cruza esta línea son hechos empresariales que el resto del sistema entiende sin saber de
 * dónde vienen.
 */

export interface NormalizedEntity {
  kind: BusinessEntityKind;
  /** Su identificador en el sistema de origen. Lo que lo hace reconocible entre pasadas. */
  externalId: string;
  displayName: string;
  attributes?: Record<string, unknown>;
}

export interface NormalizedEvent {
  kind: BusinessEventKind;
  externalId: string;
  /** Cuándo ocurrió en el negocio. Obligatorio: un hecho sin fecha no se puede analizar. */
  occurredAt: Date;
  amountCents?: number | null;
  currency?: string | null;
  quantity?: number | null;
  /** Referencia al maestro, por su identificador EXTERNO y su clase. Se resuelve al escribir. */
  subject?: { kind: BusinessEntityKind; externalId: string } | null;
  /** Qué hechos son el mismo pedido. Sin esto no hay ciclo que medir. */
  correlationId?: string | null;
  attributes?: Record<string, unknown>;
}

export interface NormalizedBatch {
  entities: NormalizedEntity[];
  events: NormalizedEvent[];
  /**
   * Por dónde se quedó el conector. Opaco para todos menos para él. **No es un secreto** y
   * por eso no se cifra: no da acceso a nada.
   */
  cursor?: unknown;
}

export const EMPTY_BATCH: NormalizedBatch = { entities: [], events: [] };

/** Lo que una escritura deja contado. Es lo que acaba en `ConnectorSync.stats`. */
export interface IngestionStats {
  entitiesCreated: number;
  entitiesUpdated: number;
  eventsCreated: number;
  /** Hechos que ya estaban. **No es un error: es la idempotencia funcionando.** */
  eventsSkippedDuplicate: number;
  /** Hechos descartados por no ser utilizables. Ver `rejections`. */
  eventsRejected: number;
}

export interface Rejection {
  externalId: string;
  reason: string;
}

/**
 * Por qué un lote se valida antes de escribirlo.
 *
 * Un hecho con fecha inválida o con importe sin moneda no se puede analizar, pero tampoco
 * puede tumbar el lote entero: un solo registro raro de un TPV dejaría sin sincronizar toda
 * la noche. Se descarta ESE, se cuenta y se dice por qué.
 *
 * Es la misma regla que ya aplica el resto del producto: ante un dato que no se entiende, no
 * se inventa y no se calla — se deja constancia.
 */
export function validateEvent(event: NormalizedEvent): string | null {
  if (!event.externalId?.trim()) {
    return 'sin identificador de origen: no se podría reconocer si llegara dos veces';
  }

  if (
    !(event.occurredAt instanceof Date) ||
    Number.isNaN(event.occurredAt.getTime())
  ) {
    return 'sin fecha válida: quedaría fuera de cualquier ventana temporal';
  }

  const tieneImporte =
    event.amountCents !== undefined && event.amountCents !== null;
  const tieneMoneda = event.currency !== undefined && event.currency !== null;
  if (tieneImporte !== tieneMoneda) {
    return 'importe y moneda tienen que venir juntos: un importe sin moneda no se puede sumar';
  }

  if (tieneImporte && !Number.isInteger(event.amountCents)) {
    return 'el importe va en céntimos enteros, para que ninguna suma arrastre error decimal';
  }

  if (
    event.quantity !== undefined &&
    event.quantity !== null &&
    !(Number.isFinite(event.quantity) && event.quantity >= 0)
  ) {
    // Una devolución es su propio hecho, con su fecha. Una cantidad negativa haría que una
    // suma se "corrigiera" sola y borraría el rastro de lo que pasó.
    return 'cantidad negativa o no finita: una devolución es un hecho propio, no un signo';
  }

  return null;
}

import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  type BusinessEntityKind,
  type BusinessEvent,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import {
  validateEvent,
  type IngestionStats,
  type NormalizedBatch,
  type NormalizedEvent,
  type Rejection,
} from '../domain/normalized-batch';

export interface RecordResult {
  stats: IngestionStats;
  rejections: Rejection[];
}

/**
 * Escribe hechos empresariales. **Idempotente por construcción.**
 *
 * ## Por qué la idempotencia no se programa aquí
 *
 * Porque no se puede confiar a la aplicación. Mirar si un hecho existe y escribirlo después
 * tiene una carrera en medio: dos entregas simultáneas del mismo webhook ven las dos que no
 * existe y las dos escriben. La garantía la da el índice único
 * `(organizationId, connectorId, kind, externalId)` y `ON CONFLICT DO NOTHING`, que es una
 * sola operación atómica.
 *
 * Aquí un duplicado no es un registro de más: es **una venta que la empresa no hizo** metida
 * en sus cuentas.
 *
 * ## Por qué un registro malo no tumba el lote
 *
 * Un TPV puede mandar una fila rara entre dos mil buenas. Rechazar el lote entero dejaría a
 * la empresa sin sincronizar toda la noche por un dato que a nadie le importaba. Se descarta
 * ese, se cuenta y se dice por qué — y lo que se dice acaba en el diagnóstico, no en un log
 * que nadie lee.
 */
@Injectable()
export class RecordBusinessFactsUseCase {
  private readonly logger = new Logger(RecordBusinessFactsUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param tx transacción de quien llama. Es lo que permite que escribir los hechos y
   *   avanzar el marcador de sincronización sean atómicos — la razón de tener la cola y los
   *   datos en la misma base.
   */
  async record(
    params: {
      organizationId: string;
      connectorId: string;
      batch: NormalizedBatch;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<RecordResult> {
    const client = tx ?? this.prisma;
    const { organizationId, connectorId, batch } = params;

    const stats: IngestionStats = {
      entitiesCreated: 0,
      entitiesUpdated: 0,
      eventsCreated: 0,
      eventsSkippedDuplicate: 0,
      eventsRejected: 0,
    };
    const rejections: Rejection[] = [];

    // Primero los maestros: un hecho puede apuntar a uno que llega en el mismo lote.
    const porClave = await this.upsertEntities(
      client,
      organizationId,
      connectorId,
      batch,
      stats,
    );

    const validos: NormalizedEvent[] = [];
    for (const event of batch.events) {
      const problema = validateEvent(event);
      if (problema) {
        stats.eventsRejected++;
        rejections.push({
          externalId: event.externalId ?? '(sin identificador)',
          reason: problema,
        });
        continue;
      }
      validos.push(event);
    }

    if (validos.length > 0) {
      const creados = await client.businessEvent.createMany({
        data: validos.map((event) =>
          this.toRow(event, organizationId, connectorId, porClave),
        ),
        // La idempotencia, en una sola operación atómica: lo que ya estaba, se ignora.
        skipDuplicates: true,
      });

      stats.eventsCreated = creados.count;
      stats.eventsSkippedDuplicate = validos.length - creados.count;
    }

    if (rejections.length > 0) {
      this.logger.warn(
        `Se descartaron ${rejections.length} hechos del conector ${connectorId} ` +
          `(organización ${organizationId}): ${rejections[0]?.reason}`,
      );
    }

    return { stats, rejections };
  }

  /**
   * Los maestros se actualizan; los hechos, no.
   *
   * Un cliente puede cambiar de nombre y sigue siendo el mismo cliente: por eso aquí hay
   * `upsert` y no `createMany`. Un hecho que ocurrió, en cambio, no cambia nunca — si la
   * operación se anula, llega otro hecho que lo dice.
   */
  private async upsertEntities(
    client: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    connectorId: string,
    batch: NormalizedBatch,
    stats: IngestionStats,
  ): Promise<Map<string, string>> {
    const porClave = new Map<string, string>();
    const ahora = new Date();

    for (const entity of batch.entities) {
      if (!entity.externalId?.trim()) continue;

      const anterior = await client.businessEntity.findUnique({
        where: {
          organizationId_connectorId_kind_externalId: {
            organizationId,
            connectorId,
            kind: entity.kind,
            externalId: entity.externalId,
          },
        },
        select: { id: true },
      });

      const fila = await client.businessEntity.upsert({
        where: {
          organizationId_connectorId_kind_externalId: {
            organizationId,
            connectorId,
            kind: entity.kind,
            externalId: entity.externalId,
          },
        },
        create: {
          organizationId,
          connectorId,
          kind: entity.kind,
          externalId: entity.externalId,
          displayName: entity.displayName,
          attributes: (entity.attributes ?? {}) as Prisma.InputJsonValue,
          lastSeenAt: ahora,
        },
        update: {
          displayName: entity.displayName,
          attributes: (entity.attributes ?? {}) as Prisma.InputJsonValue,
          lastSeenAt: ahora,
        },
        select: { id: true },
      });

      if (anterior) stats.entitiesUpdated++;
      else stats.entitiesCreated++;

      porClave.set(claveDe(entity.kind, entity.externalId), fila.id);
    }

    // Un hecho puede apuntar a un maestro que YA estaba de una pasada anterior y que no
    // vuelve en este lote. Se resuelven aquí, de una vez, en vez de consulta por hecho.
    const pendientes = batch.events
      .map((event) => event.subject)
      .filter((s): s is { kind: BusinessEntityKind; externalId: string } => !!s)
      .filter((s) => !porClave.has(claveDe(s.kind, s.externalId)));

    if (pendientes.length > 0) {
      const existentes = await client.businessEntity.findMany({
        where: {
          organizationId,
          connectorId,
          OR: pendientes.map((s) => ({
            kind: s.kind,
            externalId: s.externalId,
          })),
        },
        select: { id: true, kind: true, externalId: true },
      });

      for (const fila of existentes) {
        porClave.set(claveDe(fila.kind, fila.externalId), fila.id);
      }
    }

    return porClave;
  }

  private toRow(
    event: NormalizedEvent,
    organizationId: string,
    connectorId: string,
    porClave: Map<string, string>,
  ): Prisma.BusinessEventCreateManyInput {
    /*
     * Un maestro que no se encuentra deja el hecho SIN sujeto, no lo descarta.
     *
     * Que no sepamos a qué cliente pertenece una venta no la convierte en una venta que no
     * ocurrió: sigue contando para el total, para la franja horaria y para la evolución. Lo
     * que no podrá es agruparse por cliente, y eso se ve porque el campo está vacío.
     */
    const subjectId = event.subject
      ? (porClave.get(claveDe(event.subject.kind, event.subject.externalId)) ??
        null)
      : null;

    return {
      organizationId,
      connectorId,
      kind: event.kind,
      externalId: event.externalId,
      occurredAt: event.occurredAt,
      amountCents: event.amountCents ?? null,
      currency: event.currency ?? null,
      quantity:
        event.quantity === undefined || event.quantity === null
          ? null
          : new Prisma.Decimal(event.quantity),
      subjectId,
      correlationId: event.correlationId ?? null,
      attributes: (event.attributes ?? {}) as Prisma.InputJsonValue,
    };
  }

  /** Los hechos de un pedido, en orden. Es la base de toda métrica de ciclo. */
  async timeline(params: {
    organizationId: string;
    correlationId: string;
  }): Promise<BusinessEvent[]> {
    return this.prisma.businessEvent.findMany({
      // `organizationId` SIEMPRE en el filtro: ninguna consulta de hechos cruza la frontera
      // de una empresa, ni siquiera buscando por un identificador que se cree único.
      where: {
        organizationId: params.organizationId,
        correlationId: params.correlationId,
      },
      orderBy: { occurredAt: 'asc' },
    });
  }
}

function claveDe(kind: string, externalId: string): string {
  return `${kind}::${externalId}`;
}

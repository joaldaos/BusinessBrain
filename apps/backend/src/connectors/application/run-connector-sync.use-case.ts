import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ConnectionStatus,
  IngestionTriggerType,
  Prisma,
  RunStatus,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/utils/encryption.util';
import { forOrganization } from '../../common/utils/encryption-scope';
import { RecordBusinessFactsUseCase } from '../../business-facts/application/record-business-facts.use-case';
import type { NormalizedBatch } from '../../business-facts/domain/normalized-batch';
import { BusinessConnectorRegistry } from './business-connector-registry.service';
import { ConnectorUsageService } from './connector-usage.service';
import { budgetReachedMessage } from '../domain/connector-budget';
import type { ConnectorContext } from '../domain/ports/business-connector.port';

export interface SyncOutcome {
  syncId: string;
  status: RunStatus;
  stats: Record<string, number>;
  error?: string;
}

/**
 * Una sincronización completa: traer, normalizar, escribir y avanzar el marcador.
 *
 * ## La garantía que lo sostiene todo
 *
 * Escribir los hechos y avanzar el marcador ocurren en **una sola transacción**. Si se
 * hicieran por separado, un fallo entre medias dejaría una de dos:
 *
 * - marcador avanzado y hechos sin escribir → **esos hechos se pierden para siempre**,
 *   porque la próxima pasada empieza más adelante;
 * - hechos escritos y marcador sin avanzar → se repiten, y sin la unicidad de
 *   `BusinessEvent` serían ventas duplicadas.
 *
 * Es exactamente la razón por la que la cola vive en Postgres y no en otro almacén.
 *
 * ## Un fallo no avanza nada
 *
 * Si el proveedor falla, el marcador se queda donde estaba y la sincronización se registra
 * como fallida con su motivo. El reintento lo decide la cola, no este caso de uso: aquí se
 * lanza, y lanzar significa reintentar.
 */
@Injectable()
export class RunConnectorSyncUseCase {
  private readonly logger = new Logger(RunConnectorSyncUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: BusinessConnectorRegistry,
    private readonly facts: RecordBusinessFactsUseCase,
    private readonly encryption: EncryptionService,
    private readonly usage: ConnectorUsageService,
  ) {}

  async execute(params: {
    organizationId: string;
    connectorId: string;
    trigger?: IngestionTriggerType;
  }): Promise<SyncOutcome> {
    const { organizationId, connectorId } = params;

    // `organizationId` en el filtro, no comprobado después: una fila de otra empresa no se
    // encuentra, en vez de encontrarse y rechazarse.
    const row = await this.prisma.organizationConnector.findFirst({
      where: { id: connectorId, organizationId },
      include: { integration: true },
    });
    if (!row) {
      throw new NotFoundException(
        'Conector no encontrado en esta organización',
      );
    }

    const connector = this.registry.get(row.connectorKey);

    /*
     * El techo diario, comprobado ANTES de traer nada.
     *
     * Y una sincronización que se pasa del techo NO es un fallo: ha hecho su trabajo hasta
     * donde se le permite. Lanzar aquí gastaría los reintentos de la cola en algo que no se
     * arregla reintentando —sino esperando a mañana— y acabaría enterrando el conector, que
     * entonces dejaría de sincronizar hasta que alguien lo tocara a mano.
     */
    const presupuesto = await this.usage.status(organizationId);
    if (presupuesto.exhausted) {
      const motivo = budgetReachedMessage(presupuesto.limit);
      this.logger.warn(
        `La organización ${organizationId} alcanzó su techo diario de hechos ` +
          `(${presupuesto.used}/${presupuesto.limit}): se omite la sincronización`,
      );

      const omitida = await this.prisma.connectorSync.create({
        data: {
          connectorId: row.id,
          organizationId,
          trigger: params.trigger ?? IngestionTriggerType.MANUAL,
          status: RunStatus.SKIPPED,
          error: motivo,
          finishedAt: new Date(),
        },
        select: { id: true },
      });

      // El marcador NO se toca: lo que no entró hoy entra mañana.
      await this.prisma.organizationConnector.update({
        where: { id: row.id },
        data: { lastError: motivo },
      });

      return { syncId: omitida.id, status: RunStatus.SKIPPED, stats: {} };
    }

    const sync = await this.prisma.connectorSync.create({
      data: {
        connectorId: row.id,
        organizationId,
        trigger: params.trigger ?? IngestionTriggerType.MANUAL,
        status: RunStatus.RUNNING,
      },
      select: { id: true },
    });

    try {
      const ctx = this.contextFor(row, organizationId);
      const batch = await connector.pull(ctx, row.syncCursor ?? null);

      const { stats, rejections } = await this.prisma.$transaction(
        async (tx) => {
          const written = await this.facts.record(
            { organizationId, connectorId: row.id, batch },
            tx,
          );

          // El marcador SOLO avanza aquí dentro, con los hechos ya escritos.
          await tx.organizationConnector.update({
            where: { id: row.id },
            data: {
              // Un conector que no devuelve marcador deja el que había: no todos lo usan,
              // y confundir "no lo gestiono" con "empieza de cero" haría que cada pasada
              // releyera el histórico entero.
              syncCursor: nextCursor(batch.cursor, row.syncCursor),
              lastSyncedAt: new Date(),
              lastError: null,
              status: ConnectionStatus.CONNECTED,
            },
          });

          await tx.connectorSync.update({
            where: { id: sync.id },
            data: {
              status: RunStatus.SUCCESS,
              stats: written.stats as unknown as Prisma.InputJsonValue,
              finishedAt: new Date(),
            },
          });

          return written;
        },
      );

      /*
       * El consumo se apunta DESPUÉS y FUERA de la transacción.
       *
       * Después, porque apuntar por adelantado haría que una empresa gastara cupo por hechos
       * que no llegaron a escribirse. Fuera, porque un fallo al contar no puede deshacer lo
       * que ya está bien escrito: el contador es una salvaguarda, no el dato.
       *
       * Se cuentan los CREADOS, no los recibidos: los duplicados que la idempotencia absorbe
       * no ocupan sitio y no deben consumir el techo de nadie.
       */
      await this.usage.record(organizationId, stats.eventsCreated);

      if (rejections.length > 0) {
        this.logger.warn(
          `La sincronización ${sync.id} descartó ${rejections.length} hechos: ` +
            `${rejections[0]?.reason}`,
        );
      }

      return {
        syncId: sync.id,
        status: RunStatus.SUCCESS,
        stats: stats as unknown as Record<string, number>,
      };
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      await this.markFailed(sync.id, row.id, motivo);
      throw error;
    }
  }

  /**
   * Lo que el conector recibe. **Nunca más de lo que necesita.**
   *
   * El secreto se descifra aquí, viaja en memoria durante la llamada y se suelta: no se
   * guarda, no se registra y no vuelve en ninguna respuesta.
   */
  private contextFor(
    row: {
      id: string;
      integration: { secretEnc: string | null } | null;
    },
    organizationId: string,
  ): ConnectorContext {
    const secretEnc = row.integration?.secretEnc ?? null;

    return {
      organizationId,
      connectorId: row.id,
      secret: secretEnc
        ? JSON.parse(
            this.encryption.decryptFor(
              forOrganization(organizationId),
              secretEnc,
            ),
          )
        : null,
      config: {},
    };
  }

  /**
   * Registrar el fallo no puede fallar a su vez de forma ruidosa.
   *
   * Si la base no responde al anotar el error, lo que importa es que la excepción original
   * —la que dice qué pasó de verdad— llegue arriba y la cola reintente. Tapar esa con un
   * fallo de escritura dejaría el diagnóstico peor que no tenerlo.
   */
  private async markFailed(
    syncId: string,
    connectorId: string,
    motivo: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction([
        this.prisma.connectorSync.update({
          where: { id: syncId },
          data: {
            status: RunStatus.FAILED,
            error: motivo.slice(0, 2_000),
            finishedAt: new Date(),
          },
        }),
        // El marcador NO se toca: la próxima pasada vuelve a por lo mismo.
        this.prisma.organizationConnector.update({
          where: { id: connectorId },
          data: {
            lastError: motivo.slice(0, 2_000),
            status: ConnectionStatus.ERROR,
          },
        }),
      ]);
    } catch (fallo) {
      this.logger.error(
        `No se pudo registrar el fallo de la sincronización ${syncId}: ` +
          `${(fallo as Error).message}`,
      );
    }
  }
}

/** Lote vacío: lo que devuelve un conector que no tiene nada nuevo que traer. */
export const SIN_NOVEDADES: NormalizedBatch = { entities: [], events: [] };

/**
 * El marcador que toca guardar.
 *
 * Prisma distingue tres cosas donde JavaScript ve dos: dejar la columna como está
 * (`undefined`), ponerla a nulo en la base (`Prisma.DbNull`) y escribir un valor. Sin esa
 * distinción, un conector sin marcador borraría el que hubiera.
 */
function nextCursor(
  devuelto: unknown,
  actual: Prisma.JsonValue | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (devuelto === undefined) {
    return actual === null ? undefined : actual;
  }
  if (devuelto === null) return Prisma.DbNull;
  return devuelto;
}

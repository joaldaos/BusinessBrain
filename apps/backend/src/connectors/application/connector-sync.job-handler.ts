import { Injectable, NotFoundException } from '@nestjs/common';
import { IngestionTriggerType } from '@businessbrain/database';
import type {
  JobContext,
  JobHandler,
} from '../../jobs/domain/ports/job-queue.port';
import { RunConnectorSyncUseCase } from './run-connector-sync.use-case';

/** Clave del trabajo. Única y estable: la cola la usa para encontrar quién lo atiende. */
export const CONNECTOR_SYNC_JOB = 'connector.sync';

/**
 * Sincronizar un conector, desde la cola.
 *
 * Es el único punto donde se decide qué fallo merece reintento y cuál no, y la regla del
 * puerto es explícita: **lanzar significa reintentar**.
 *
 * Por eso un conector que ya no existe NO se relanza. Que la empresa lo haya borrado, o que
 * la clave apunte a una implementación retirada, no es un problema transitorio: reintentarlo
 * cinco veces con esperas crecientes solo retrasa cinco veces el diagnóstico y ocupa turno
 * mientras tanto. Se termina sin lanzar y la cola lo da por cumplido.
 */
@Injectable()
export class ConnectorSyncJobHandler implements JobHandler {
  readonly kind = CONNECTOR_SYNC_JOB;

  constructor(private readonly sync: RunConnectorSyncUseCase) {}

  async handle(job: JobContext): Promise<void> {
    const { organizationId, connectorId } = leerPayload(job);

    try {
      await this.sync.execute({
        organizationId,
        connectorId,
        trigger: IngestionTriggerType.SCHEDULE,
      });
    } catch (error) {
      if (error instanceof NotFoundException) return;
      throw error;
    }
  }
}

/**
 * El contenido del trabajo, leído con desconfianza.
 *
 * Es una columna JSON que pudo escribirse con otra versión del código. Un contenido que no
 * se entiende es un fallo permanente, no transitorio: se lanza con un mensaje que lo dice,
 * para que la cola lo entierre en vez de reintentarlo cinco veces.
 */
function leerPayload(job: JobContext): {
  organizationId: string;
  connectorId: string;
} {
  const payload = job.payload as { connectorId?: unknown } | null;
  const connectorId =
    payload && typeof payload.connectorId === 'string'
      ? payload.connectorId
      : null;

  if (!job.organizationId || !connectorId) {
    throw new Error(
      `El trabajo ${job.id} no dice qué conector sincronizar ni de qué empresa`,
    );
  }

  return { organizationId: job.organizationId, connectorId };
}

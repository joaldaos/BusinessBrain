import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConnectionStatus } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/utils/encryption.util';
import { forOrganization } from '../../common/utils/encryption-scope';
import {
  JOB_QUEUE_PORT,
  type JobQueuePort,
} from '../../jobs/domain/ports/job-queue.port';
import { Inject } from '@nestjs/common';
import { CONNECTOR_SYNC_JOB } from './connector-sync.job-handler';
import {
  RESPUESTA_AL_RECHAZAR,
  verifyWebhook,
  type WebhookRejection,
} from '../domain/webhook-signature';

export interface IncomingWebhook {
  connectorId: string;
  rawBody: Buffer | string;
  signature?: string;
  timestamp?: string;
}

/**
 * Un envío entrante: se verifica y se encola. **Nunca se procesa en la petición.**
 *
 * ## Por qué encolar y no trabajar aquí mismo
 *
 * Un proveedor que no recibe respuesta en segundos reintenta, y algunos desactivan el
 * webhook tras varios tiempos de espera. Si la petición se quedara esperando a que se
 * traigan y escriban los hechos, una sincronización lenta se convertiría en una conexión
 * desactivada. Se responde en cuanto la firma es válida y el trabajo real lo hace la cola,
 * que además sabe reintentar.
 *
 * ## Por qué un rechazo no explica nada
 *
 * Decirle a quien prueba si falló la firma o la ventana le dice qué parte ya tiene bien. El
 * motivo concreto se registra dentro; fuera siempre sale lo mismo.
 */
@Injectable()
export class ReceiveWebhookUseCase {
  private readonly logger = new Logger(ReceiveWebhookUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    @Inject(JOB_QUEUE_PORT) private readonly queue: JobQueuePort,
  ) {}

  async receive(incoming: IncomingWebhook): Promise<{ accepted: true }> {
    const connector = await this.prisma.organizationConnector.findUnique({
      where: { id: incoming.connectorId },
      select: {
        id: true,
        organizationId: true,
        status: true,
        integration: { select: { secretEnc: true, revokedAt: true } },
      },
    });

    /*
     * Un conector que no existe se rechaza EXACTAMENTE igual que una firma mala.
     *
     * Responder 404 permitiría recorrer identificadores para descubrir cuáles existen, y eso
     * ya es información sobre los clientes que hay.
     */
    if (!connector) return this.rechazar(incoming.connectorId, 'SIN_FIRMA');

    const secretEnc = connector.integration?.secretEnc;
    if (!secretEnc || connector.integration?.revokedAt) {
      return this.rechazar(connector.id, 'SIN_FIRMA', connector.organizationId);
    }

    const secret = this.encryption.decryptFor(
      forOrganization(connector.organizationId),
      secretEnc,
    );

    const resultado = verifyWebhook({
      rawBody: incoming.rawBody,
      signature: incoming.signature,
      timestamp: incoming.timestamp,
      secret,
    });

    if (!resultado.ok) {
      return this.rechazar(
        connector.id,
        resultado.reason!,
        connector.organizationId,
      );
    }

    /*
     * Un envío NO trae los datos: trae el aviso de que hay algo nuevo.
     *
     * Así el cuerpo del webhook deja de ser una vía de escritura —nadie puede inyectar una
     * venta aunque conozca el secreto— y la verdad sigue viniendo del proveedor, que es
     * quien la tiene. La `dedupeKey` hace además que diez avisos seguidos encolen UN trabajo.
     */
    await this.queue.enqueue({
      kind: CONNECTOR_SYNC_JOB,
      organizationId: connector.organizationId,
      payload: { connectorId: connector.id, origen: 'webhook' },
      dedupeKey: `${CONNECTOR_SYNC_JOB}:${connector.id}`,
    });

    if (connector.status === ConnectionStatus.ERROR) {
      // Un envío válido demuestra que la conexión vive otra vez. El estado definitivo lo
      // fijará la sincronización; esto solo evita que siga dando por caído lo que no lo está.
      this.logger.log(
        `El conector ${connector.id} vuelve a recibir envíos tras un error`,
      );
    }

    return { accepted: true };
  }

  /**
   * Siempre la misma respuesta hacia fuera; el motivo, dentro.
   *
   * Se registra sin el cuerpo: puede traer datos de clientes de la empresa, y un registro no
   * es sitio para eso.
   */
  private rechazar(
    connectorId: string,
    reason: WebhookRejection,
    organizationId?: string,
  ): never {
    this.logger.warn(
      `Envío rechazado para el conector ${connectorId}` +
        (organizationId ? ` (organización ${organizationId})` : '') +
        `: ${reason}`,
    );
    throw new UnauthorizedException(RESPUESTA_AL_RECHAZAR);
  }
}

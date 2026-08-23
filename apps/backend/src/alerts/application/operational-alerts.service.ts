import { Inject, Injectable, Logger } from '@nestjs/common';
import { RunStatus } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { ALERTS_PORT, type AlertsPort } from '../domain/alerts.port';
import { REPEATED_FAILURE_THRESHOLD } from '../domain/operational-alert';

/**
 * Quién decide que hay que avisar.
 *
 * ## Avisar NUNCA rompe la operación
 *
 * Misma regla que la auditoría, y por la misma razón: un fallo al mandar el aviso no puede
 * convertir en error algo que ya ocurrió. Aquí es todavía más claro — lo que se está avisando
 * ES un fallo, y hacer que el aviso lo empeore sería absurdo. Todo lo de aquí se traga sus
 * propias excepciones.
 *
 * ## Por qué el fallo repetido se cuenta y no se acumula en una columna
 *
 * Los trabajos de ingesta ya están todos en la base de datos con su resultado. Contar los
 * últimos es una consulta; llevar un contador en `KnowledgeSource` sería un segundo sitio
 * donde guardar lo mismo, que hay que acordarse de poner a cero cuando la fuente vuelve a ir
 * bien — y el día que a alguien se le olvide, la fuente sana seguirá avisando.
 */
@Injectable()
export class OperationalAlertsService {
  private readonly logger = new Logger(OperationalAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ALERTS_PORT) private readonly alerts: AlertsPort,
  ) {}

  /**
   * Una sincronización ha fallado.
   *
   * Avisa siempre, y además comprueba si esta fuente lleva ya varios fallos seguidos. Son dos
   * avisos distintos porque significan cosas distintas: uno es "esta noche ha ido mal" y el
   * otro es "esto no se va a arreglar solo".
   */
  async syncFailed(params: {
    organizationId: string;
    knowledgeSourceId: string;
    detail: string;
  }): Promise<void> {
    await this.safely(async () => {
      await this.alerts.raise({
        kind: 'sync-failed',
        organizationId: params.organizationId,
        targetId: params.knowledgeSourceId,
        detail: params.detail,
      });

      const seguidos = await this.consecutiveFailures(params.knowledgeSourceId);
      if (seguidos >= REPEATED_FAILURE_THRESHOLD) {
        await this.alerts.raise({
          kind: 'source-failing-repeatedly',
          organizationId: params.organizationId,
          targetId: params.knowledgeSourceId,
          detail: params.detail,
          consecutiveFailures: seguidos,
        });
      }
    });
  }

  async analysisFailed(params: {
    organizationId: string;
    analysisRunId: string;
    detail: string;
  }): Promise<void> {
    await this.safely(() =>
      this.alerts.raise({
        kind: 'analysis-failed',
        organizationId: params.organizationId,
        targetId: params.analysisRunId,
        detail: params.detail,
      }),
    );
  }

  /**
   * Cuántas ejecuciones seguidas ha fallado esta fuente, empezando por la última.
   *
   * Se leen las últimas y se cuentan las que fallaron DESDE EL PRINCIPIO: una que fue bien
   * corta la racha. "Tres fallos de las últimas diez" es una fuente con altibajos; "las tres
   * últimas" es una fuente rota.
   */
  private async consecutiveFailures(
    knowledgeSourceId: string,
  ): Promise<number> {
    const ultimos = await this.prisma.ingestionJob.findMany({
      where: { knowledgeSourceId },
      orderBy: { startedAt: 'desc' },
      take: REPEATED_FAILURE_THRESHOLD,
      select: { status: true },
    });

    let seguidos = 0;
    for (const job of ultimos) {
      if (job.status !== RunStatus.FAILED) break;
      seguidos += 1;
    }
    return seguidos;
  }

  private async safely(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.error(
        `No se pudo emitir una alerta operativa: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { AnalysisRunStatus, AnalysisRunTrigger } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import {
  admitAnalysisRun,
  blockedRunExplanation,
} from '../domain/analysis-run-concurrency';

/**
 * Control OPERATIVO del disparo manual de análisis — subfase 6.1.
 *
 * ## Qué NO es
 *
 * **No es un invariante de dominio, y no debe convertirse en uno.**
 * `UNDERSTANDING_ENGINE_DESIGN.md` considera explícitamente la alternativa "permitir como
 * máximo un `AnalysisRun` EN CURSO por organización" y **la rechaza** (§20, tabla de
 * alternativas): serializar bloquearía todo el análisis por evento detrás de una estrategia
 * generativa lenta —bloqueo de cabecera de línea— justo en el escenario de agentes autónomos
 * de alta frecuencia, y no toca ninguna de las dos causas reales de interferencia. La
 * corrección bajo concurrencia ya está garantizada por la unicidad de identidad de sujeto por
 * exclusión de estados terminales y por `ResolveInsightConflict` (§12), no por restringir la
 * ejecución.
 *
 * El propio documento indica dónde va este control: §3.1 y §22 lo sitúan como "límite de tasa
 * y política de concurrencia máxima por organización, tratados explícitamente como **control
 * operativo, nunca como invariante de dominio**". Esto es exactamente eso.
 *
 * ## Qué SÍ es
 *
 * Una protección de la superficie HTTP de disparo manual contra el doble clic y el reintento
 * automático del proxy. Un análisis dura decenas de segundos y cuesta recuperaciones
 * vectoriales y llamadas al modelo **contra la clave del propio cliente**; un reintento
 * duplicaría esa factura sin producir más comprensión.
 *
 * ## Por qué no afecta a los disparos automáticos
 *
 * El cerrojo lo toma ÚNICAMENTE este servicio, y a este servicio solo lo llama
 * `POST /analysis-runs`. Un planificador, un disparo por evento o un agente que invoquen
 * `TriggerAnalysisRunUseCase` directamente no pasan por aquí, no adquieren ningún cerrojo y
 * conservan intacta la concurrencia del §3.1.
 *
 * ## Por qué la transacción es corta
 *
 * Reclama la fila y suelta. El trabajo largo ocurre fuera: mantener abierta una transacción
 * con el cerrojo tomado durante toda la ejecución reintroduciría por la puerta de atrás
 * exactamente el bloqueo de cabecera de línea que el diseño rechaza.
 */
@Injectable()
export class ManualTriggerAdmissionService {
  private readonly logger = new Logger(ManualTriggerAdmissionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reclama el derecho a lanzar un análisis manual y devuelve la fila reservada.
   *
   * Comprobar y después insertar no sería atómico: dos peticiones simultáneas verían ambas
   * que no hay nada en curso. Lo que hay que serializar es la AUSENCIA de fila, sobre la que
   * no se puede bloquear, y de ahí el cerrojo consultivo por organización.
   */
  async claim(organizationId: string): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;

      const inFlight = await tx.analysisRun.findFirst({
        where: {
          organizationId,
          status: {
            in: [AnalysisRunStatus.PENDING, AnalysisRunStatus.RUNNING],
          },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, startedAt: true, createdAt: true },
      });

      const admission = admitAnalysisRun({ inFlight, now: new Date() });

      if (admission.decision === 'REJECT') {
        throw new ConflictException(
          blockedRunExplanation(admission.blockingRunId, admission.startedAt),
        );
      }

      if (admission.decision === 'RECLAIM') {
        // Recuperación de ejecuciones abandonadas: sin ella, un proceso que muera a mitad
        // dejaría el disparo manual bloqueado para siempre y este control se convertiría en
        // una denegación de servicio contra uno mismo.
        //
        // Se cierra como fallida, no se borra: una ejecución abandonada es un hecho que forma
        // parte del historial de la organización.
        await tx.analysisRun.updateMany({
          where: {
            id: admission.abandonedRunId,
            status: {
              in: [AnalysisRunStatus.PENDING, AnalysisRunStatus.RUNNING],
            },
          },
          data: {
            status: AnalysisRunStatus.FAILED,
            completedAt: new Date(),
            error:
              'Ejecución abandonada: superó el umbral sin terminar y fue recuperada al ' +
              'lanzarse un análisis manual nuevo',
          },
        });
        this.logger.warn(
          `Ejecución abandonada ${admission.abandonedRunId} recuperada en la organización ` +
            `${organizationId}`,
        );
      }

      // La fila nace `PENDING`: reserva el hueco frente a otro disparo manual simultáneo. El
      // caso de uso la adopta y la pasa a `RUNNING` al empezar de verdad.
      return tx.analysisRun.create({
        data: {
          organizationId,
          trigger: AnalysisRunTrigger.MANUAL,
          status: AnalysisRunStatus.PENDING,
        },
        select: { id: true },
      });
    });
  }

  /**
   * Libera la reserva cuando la ejecución ni siquiera llegó a empezar.
   *
   * Sin esto, un fallo temprano dejaría una fila `PENDING` ocupando el hueco hasta que
   * venciera el umbral de abandono.
   */
  async releaseUnstarted(runId: string): Promise<void> {
    await this.prisma.analysisRun.updateMany({
      where: { id: runId, status: AnalysisRunStatus.PENDING },
      data: {
        status: AnalysisRunStatus.FAILED,
        completedAt: new Date(),
        error: 'El disparo manual no llegó a iniciar la ejecución',
      },
    });
  }
}

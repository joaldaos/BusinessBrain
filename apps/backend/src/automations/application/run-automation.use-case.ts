import { Injectable, Logger } from '@nestjs/common';
import {
  AutomationStatus,
  MembershipRole,
  Prisma,
  RunStatus,
  type Automation,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import { TriggerAnalysisRunUseCase } from '../../understanding-engine/application/trigger-analysis-run.use-case';
import { AnalysisRunTrigger } from '@businessbrain/database';
import { ReportsService } from '../../reports/application/reports.service';
import { IngestFromSourceUseCase } from '../../knowledge-engine/application/ingest-from-source.use-case';
import { IngestionTriggerType } from '@businessbrain/database';
import { parseAutomationActions } from '../domain/automation-plan';

/** Una línea del diario de la ejecución. Se guarda en `AutomationRun.logs`. */
interface RunLogEntry {
  at: string;
  action: string;
  outcome: 'SUCCESS' | 'FAILED';
  detail: string;
}

/**
 * Ejecuta una automatización — BUSINESSBRAIN_MIGRATION_PLAN.md §10 (fase 6).
 *
 * ## En nombre de quién corre
 *
 * Una ejecución programada no tiene a nadie delante, pero sí tiene un responsable: quien la
 * creó (`createdById`). No es un detalle de atribución, es una condición de seguridad — y por
 * eso **se comprueba en cada ejecución, no solo al crearla**: si esa persona deja la
 * organización, la automatización se detiene. De lo contrario sería un mecanismo para que un
 * acceso revocado siguiera produciendo efectos indefinidamente, que es precisamente la clase
 * de puerta que no se ve hasta que alguien la usa.
 *
 * ## Un paso que falla no borra los que salieron bien
 *
 * Cada acción se ejecuta y se anota por separado. La ejecución termina como `FAILED` si algo
 * falló, pero el diario conserva qué llegó a hacerse: una ejecución nocturna sobre la que solo
 * consta "falló" es indistinguible de una que no hizo nada, y no lo son.
 */
@Injectable()
export class RunAutomationUseCase {
  private readonly logger = new Logger(RunAutomationUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly analysis: TriggerAnalysisRunUseCase,
    private readonly reports: ReportsService,
    private readonly ingest: IngestFromSourceUseCase,
  ) {}

  async execute(automation: Automation): Promise<{
    runId: string;
    status: RunStatus;
  }> {
    const run = await this.prisma.automationRun.create({
      data: { automationId: automation.id, status: RunStatus.RUNNING },
      select: { id: true },
    });

    const logs: RunLogEntry[] = [];
    let error: string | null = null;

    try {
      await this.assertOwnerStillBelongs(automation);

      for (const action of parseAutomationActions(automation.actions)) {
        switch (action.type) {
          case 'RUN_ANALYSIS': {
            // Disparo AUTOMÁTICO: no pasa por `ManualTriggerAdmissionService`, que es un
            // control operativo de la superficie manual (§3.1, §488). Varias ejecuciones
            // simultáneas de análisis son legítimas y no se serializan.
            const result = await this.analysis.execute({
              organizationId: automation.organizationId,
              trigger: AnalysisRunTrigger.PERIODIC_SWEEP,
            });
            logs.push({
              at: new Date().toISOString(),
              action: action.type,
              outcome: result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
              detail:
                `AnalysisRun ${result.analysisRunId}: ${result.insightsCreated} conclusión(es) ` +
                `nueva(s), ${result.insightsAlreadyKnown} ya conocida(s)`,
            });
            if (result.status !== 'SUCCESS') {
              throw new Error(`El análisis terminó en estado ${result.status}`);
            }
            break;
          }

          case 'SYNC_KNOWLEDGE_SOURCE': {
            // El conocimiento entra SOLO. La idempotencia no la pone esta acción: la garantiza
            // la deduplicación de la tubería — mismo contenido, mismo hash, duplicado exacto
            // reconocido; contenido cambiado, versión nueva con su arista de linaje.
            const result = await this.ingest.execute({
              organizationId: automation.organizationId,
              knowledgeSourceId: action.knowledgeSourceId,
              connectorInput: {},
              triggerType: IngestionTriggerType.SCHEDULE,
            });
            logs.push({
              at: new Date().toISOString(),
              action: action.type,
              outcome: result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
              detail:
                `IngestionJob ${result.ingestionJobId}: ${result.stats.itemsCreated} ` +
                `nuevo(s), ${result.stats.itemsUpdated} actualizado(s), ` +
                `${result.stats.itemsSkippedDuplicate} sin cambios`,
            });
            if (result.status !== 'SUCCESS') {
              throw new Error(
                `La sincronización terminó en estado ${result.status}`,
              );
            }
            break;
          }

          case 'GENERATE_REPORT': {
            // EN NOMBRE de quien creó la automatización, cuya membresía se acaba de
            // verificar. De ahí sale el alcance: el informe no puede contener nada que esa
            // persona no pudiera leer por HTTP. Que corra sin nadie delante no relaja nada.
            const generated = await this.reports.generate({
              organizationId: automation.organizationId,
              actorUserId: automation.createdById,
              reportId: action.reportId,
              trigger: 'AUTOMATION',
            });
            // El PDF no se guarda ni se envía a nadie: enviarlo sería un efecto externo, y
            // eso es `IntegrationsModule`. Queda el `ReportRun` con su evidencia.
            logs.push({
              at: new Date().toISOString(),
              action: action.type,
              outcome: 'SUCCESS',
              detail:
                `ReportRun ${generated.runId}: ${generated.content.length} bytes ` +
                `generados y NO almacenados`,
            });
            break;
          }
        }
      }
    } catch (caught) {
      error = (caught as Error).message;
      logs.push({
        at: new Date().toISOString(),
        action: 'RUN',
        outcome: 'FAILED',
        detail: error,
      });
      this.logger.warn(
        `Automatización ${automation.id} de la organización ` +
          `${automation.organizationId}: ${error}`,
      );
    }

    const status = error ? RunStatus.FAILED : RunStatus.SUCCESS;

    await this.prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        logs: logs as unknown as Prisma.InputJsonValue,
        error,
      },
    });
    await this.prisma.automation.update({
      where: { id: automation.id },
      data: { lastRunAt: new Date() },
    });

    // Sin actor: no lo provocó una persona. `AuditService` admite acciones de sistema (6.2).
    await this.audit.record({
      organizationId: automation.organizationId,
      action: AUDIT_ACTIONS.AUTOMATION_RUN_FINISHED,
      targetType: AUDIT_TARGET_TYPES.AUTOMATION,
      targetId: automation.id,
      metadata: {
        runId: run.id,
        status,
        trigger: automation.triggerType,
        steps: logs.length,
        externalActionExecuted: false,
      },
    });

    return { runId: run.id, status };
  }

  /**
   * Quien creó la automatización debe seguir siendo miembro de la organización.
   *
   * Al fallar, la automatización pasa a `ERROR` y deja de reclamarse. No se elimina: hay que
   * poder ver por qué se detuvo, y otra persona con permiso puede adoptarla reactivándola.
   */
  private async assertOwnerStillBelongs(automation: Automation): Promise<void> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: automation.createdById,
        organizationId: automation.organizationId,
        role: {
          in: [
            MembershipRole.OWNER,
            MembershipRole.ADMIN,
            MembershipRole.MEMBER,
          ],
        },
      },
      select: { id: true },
    });
    if (membership) return;

    await this.prisma.automation.update({
      where: { id: automation.id },
      data: { status: AutomationStatus.ERROR, nextRunAt: null },
    });

    throw new Error(
      'Quien creó esta automatización ya no pertenece a la organización: se detiene en ' +
        'lugar de seguir ejecutándose en nombre de un acceso revocado',
    );
  }
}

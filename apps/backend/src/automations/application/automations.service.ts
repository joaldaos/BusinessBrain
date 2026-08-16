import {
  BadRequestException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AutomationStatus,
  AutomationTriggerType,
  Prisma,
  type Automation,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import { pageBounds } from '../../common/dto/pagination.dto';
import {
  InvalidAutomationPlanError,
  parseAutomationActions,
  parseScheduleTrigger,
  type AutomationAction,
  type ScheduleTrigger,
} from '../domain/automation-plan';
import {
  SCHEDULER_PORT,
  type SchedulerPort,
} from '../domain/ports/scheduler.port';
import { ConnectorRegistry } from '../../knowledge-engine/infrastructure/connectors/connector-registry.service';

/**
 * Ciclo de vida de las automatizaciones — BUSINESSBRAIN_MIGRATION_PLAN.md §5, §10 (fase 6).
 *
 * Una automatización decide CUÁNDO ocurre algo que el sistema ya sabe hacer. Nunca amplía lo
 * que puede hacerse: el plan se valida contra un catálogo cerrado (`parseAutomationActions`)
 * antes de guardarse, no al dispararse. Validar en el disparo dejaría automatizaciones
 * "activas" que fallan de madrugada sin que nadie se entere.
 */
@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(SCHEDULER_PORT) private readonly scheduler: SchedulerPort,
    private readonly connectors: ConnectorRegistry,
  ) {}

  async create(params: {
    organizationId: string;
    actorUserId: string;
    name: string;
    triggerType: AutomationTriggerType;
    triggerConfig: unknown;
    actions: unknown;
  }): Promise<Automation> {
    const { actions, nextRunAt, triggerConfig } = this.validatePlan({
      organizationId: params.organizationId,
      triggerType: params.triggerType,
      triggerConfig: params.triggerConfig,
      actions: params.actions,
    });
    await this.assertReferencesBelongToOrg(params.organizationId, actions);
    await this.assertSourcesAreSchedulable(params.organizationId, actions);

    const automation = await this.prisma.automation.create({
      data: {
        organizationId: params.organizationId,
        name: params.name,
        triggerType: params.triggerType,
        triggerConfig: triggerConfig as Prisma.InputJsonValue,
        actions: actions,
        createdById: params.actorUserId,
        nextRunAt,
      },
    });

    // Crear una automatización es conceder ejecución desatendida: queda traza, igual que
    // conceder capacidades a un agente (5.7).
    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.actorUserId,
      action: AUDIT_ACTIONS.AUTOMATION_CREATED,
      targetType: AUDIT_TARGET_TYPES.AUTOMATION,
      targetId: automation.id,
      metadata: {
        name: params.name,
        triggerType: params.triggerType,
        actionTypes: actions.map((action) => action.type),
        nextRunAt: nextRunAt?.toISOString() ?? null,
      },
    });

    return automation;
  }

  async list(params: {
    organizationId: string;
    status?: AutomationStatus;
    limit?: number;
    offset?: number;
  }) {
    const { take, skip } = pageBounds(params);

    return this.prisma.automation.findMany({
      where: {
        organizationId: params.organizationId,
        ...(params.status ? { status: params.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { runs: true } } },
      take,
      skip,
    });
  }

  async findOne(params: {
    organizationId: string;
    automationId: string;
  }): Promise<Automation> {
    const automation = await this.prisma.automation.findFirst({
      where: { id: params.automationId, organizationId: params.organizationId },
    });
    if (!automation)
      throw new NotFoundException('Automatización no encontrada');

    return automation;
  }

  /** Historial de ejecuciones. Paginado en SQL: crece sin límite natural con el tiempo. */
  async listRuns(params: {
    organizationId: string;
    automationId: string;
    limit?: number;
    offset?: number;
  }) {
    await this.findOne(params);
    const { take, skip } = pageBounds(params);

    return this.prisma.automationRun.findMany({
      where: { automationId: params.automationId },
      orderBy: { startedAt: 'desc' },
      take,
      skip,
    });
  }

  async update(params: {
    organizationId: string;
    actorUserId: string;
    automationId: string;
    name?: string;
    status?: AutomationStatus;
    triggerType?: AutomationTriggerType;
    triggerConfig?: unknown;
    actions?: unknown;
  }): Promise<Automation> {
    const existing = await this.findOne(params);

    const triggerType = params.triggerType ?? existing.triggerType;
    const status = params.status ?? existing.status;
    const plan = this.validatePlan({
      organizationId: params.organizationId,
      triggerType,
      triggerConfig: params.triggerConfig ?? existing.triggerConfig,
      actions: params.actions ?? existing.actions,
      // Una automatización pausada no se reclama nunca: lo que no tiene fecha no vence.
      // Reanudarla vuelve a calcularla, así que pausar no pierde el calendario.
      paused: status !== AutomationStatus.ACTIVE,
    });

    await this.assertReferencesBelongToOrg(params.organizationId, plan.actions);
    await this.assertSourcesAreSchedulable(params.organizationId, plan.actions);

    const updated = await this.prisma.automation.update({
      where: { id: existing.id },
      data: {
        ...(params.name !== undefined ? { name: params.name } : {}),
        status,
        triggerType,
        triggerConfig: plan.triggerConfig as Prisma.InputJsonValue,
        actions: plan.actions,
        nextRunAt: plan.nextRunAt,
      },
    });

    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.actorUserId,
      action: AUDIT_ACTIONS.AUTOMATION_UPDATED,
      targetType: AUDIT_TARGET_TYPES.AUTOMATION,
      targetId: existing.id,
      metadata: {
        status,
        triggerType,
        actionTypes: plan.actions.map((action) => action.type),
        nextRunAt: plan.nextRunAt?.toISOString() ?? null,
      },
    });

    return updated;
  }

  /**
   * Retirada. Baja lógica, nunca borrado: el historial de lo que se ejecutó desatendido es
   * justo lo que no se debe poder hacer desaparecer.
   */
  async remove(params: {
    organizationId: string;
    actorUserId: string;
    automationId: string;
  }): Promise<Automation> {
    const existing = await this.findOne(params);

    const removed = await this.prisma.automation.update({
      where: { id: existing.id },
      data: { status: AutomationStatus.PAUSED, nextRunAt: null },
    });

    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.actorUserId,
      action: AUDIT_ACTIONS.AUTOMATION_DELETED,
      targetType: AUDIT_TARGET_TYPES.AUTOMATION,
      targetId: existing.id,
      metadata: { name: existing.name },
    });

    return removed;
  }

  /**
   * Valida el plan completo y calcula cuándo toca.
   *
   * Las referencias se comprueban contra la organización SIEMPRE, también al modificar: una
   * automatización creada cuando el agente existía no puede seguir apuntándolo después de que
   * lo hayan retirado, ni empezar a apuntar al de otro tenant.
   */
  private validatePlan(params: {
    organizationId: string;
    triggerType: AutomationTriggerType;
    triggerConfig: unknown;
    actions: unknown;
    paused?: boolean;
  }): {
    actions: AutomationAction[];
    triggerConfig: ScheduleTrigger | Record<string, unknown>;
    nextRunAt: Date | null;
  } {
    let actions: AutomationAction[];
    try {
      actions = parseAutomationActions(params.actions);
    } catch (error) {
      if (error instanceof InvalidAutomationPlanError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    if (params.triggerType !== AutomationTriggerType.SCHEDULE) {
      // Manual y por evento no tienen vencimiento: nada que reclamar.
      return {
        actions,
        triggerConfig: (params.triggerConfig ?? {}) as Record<string, unknown>,
        nextRunAt: null,
      };
    }

    let schedule: ScheduleTrigger;
    try {
      schedule = parseScheduleTrigger(params.triggerConfig);
    } catch (error) {
      if (error instanceof InvalidAutomationPlanError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    if (params.paused) {
      return { actions, triggerConfig: schedule, nextRunAt: null };
    }

    const nextRunAt = this.scheduler.nextOccurrence({
      cron: schedule.cron,
      timezone: schedule.timezone,
      from: new Date(),
    });
    if (!nextRunAt) {
      throw new BadRequestException(
        `La expresión "${schedule.cron}" en ${schedule.timezone} no produce ninguna ` +
          `ejecución futura`,
      );
    }

    return { actions, triggerConfig: schedule, nextRunAt };
  }

  /**
   * Todo lo que el plan NOMBRA debe existir en ESTA organización.
   *
   * Se comprueba también al modificar, no solo al crear: una automatización que apuntaba a un
   * informe existente no puede seguir apuntándolo después de que lo retiren, ni empezar a
   * apuntar al de otro tenant. Sin esto, el reloj sería una vía para generar el informe de
   * otra organización a las tres de la mañana, cuando no hay nadie mirando.
   */
  private async assertReferencesBelongToOrg(
    organizationId: string,
    actions: AutomationAction[],
  ): Promise<void> {
    const reportIds = [
      ...new Set(
        actions
          .filter(
            (
              action,
            ): action is Extract<
              AutomationAction,
              { type: 'GENERATE_REPORT' }
            > => action.type === 'GENERATE_REPORT',
          )
          .map((action) => action.reportId),
      ),
    ];
    if (reportIds.length === 0) return;

    const found = await this.prisma.report.count({
      where: { id: { in: reportIds }, organizationId },
    });
    if (found !== reportIds.length) {
      throw new BadRequestException(
        'Alguno de los informes indicados no existe o pertenece a otra organización',
      );
    }
  }

  /**
   * Las fuentes que se van a sincronizar deben existir en ESTA organización y —además— saber
   * ir a buscar su contenido.
   *
   * Programar la sincronización de una fuente de subida manual dejaría una automatización que
   * falla cada semana de madrugada esperando un archivo que nadie va a subir. Se rechaza al
   * crearla, no al dispararla.
   */
  private async assertSourcesAreSchedulable(
    organizationId: string,
    actions: AutomationAction[],
  ): Promise<void> {
    const sourceIds = [
      ...new Set(
        actions
          .filter(
            (
              action,
            ): action is Extract<
              AutomationAction,
              { type: 'SYNC_KNOWLEDGE_SOURCE' }
            > => action.type === 'SYNC_KNOWLEDGE_SOURCE',
          )
          .map((action) => action.knowledgeSourceId),
      ),
    ];
    if (sourceIds.length === 0) return;

    const sources = await this.prisma.knowledgeSource.findMany({
      where: { id: { in: sourceIds }, organizationId },
      select: { id: true, name: true, connectorKey: true },
    });
    if (sources.length !== sourceIds.length) {
      throw new BadRequestException(
        'Alguna de las fuentes indicadas no existe o pertenece a otra organización',
      );
    }

    for (const source of sources) {
      if (this.connectors.get(source.connectorKey).acquisition !== 'PULL') {
        throw new BadRequestException(
          `La fuente "${source.name}" espera que alguien suba un archivo, así que no ` +
            `puede sincronizarse sola. Solo las fuentes que van a buscar su contenido ` +
            `—como una dirección web— pueden programarse`,
        );
      }
    }
  }
}

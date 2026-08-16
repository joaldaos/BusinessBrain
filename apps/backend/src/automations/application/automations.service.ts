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
}

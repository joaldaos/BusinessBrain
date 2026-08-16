import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReportFormat,
  RunStatus,
  type Report,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import { pageBounds } from '../../common/dto/pagination.dto';
import {
  InvalidReportTemplateError,
  parseReportTemplate,
} from '../domain/report-template';
import { ComposeReportUseCase } from './compose-report.use-case';
import { PdfRenderer } from '../infrastructure/pdf-renderer';

export interface GeneratedReport {
  runId: string;
  fileName: string;
  content: Buffer;
  format: ReportFormat;
}

/**
 * Informes — BUSINESSBRAIN_MIGRATION_PLAN.md §5, §10 (fase 6).
 *
 * ## El fichero NO se persiste
 *
 * `POST /reports/:id/generate` devuelve el PDF en la respuesta y no lo guarda en ninguna
 * parte. El proyecto no tiene todavía almacenamiento de objetos, y dejar comprensión
 * confidencial en una ruta sin política de retención ni control de acceso sería peor que no
 * tenerla: un PDF es la forma más fácil de que una fuga sobreviva a los permisos.
 *
 * Lo que sí queda es el `ReportRun`: cuándo se generó, en nombre de quién, con qué alcance y
 * sobre qué evidencia exacta. Eso hace el informe **reproducible y auditable** sin conservar
 * el fichero — mismo criterio que el resto del sistema con las proyecciones derivadas.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly composer: ComposeReportUseCase,
    private readonly renderer: PdfRenderer,
  ) {}

  async create(params: {
    organizationId: string;
    actorUserId: string;
    name: string;
    format?: ReportFormat;
    template: unknown;
  }): Promise<Report> {
    const template = this.validate(params.template);

    const report = await this.prisma.report.create({
      data: {
        organizationId: params.organizationId,
        name: params.name,
        format: params.format ?? ReportFormat.PDF,
        template: template as unknown as Prisma.InputJsonValue,
        createdById: params.actorUserId,
      },
    });

    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.actorUserId,
      action: AUDIT_ACTIONS.REPORT_CREATED,
      targetType: AUDIT_TARGET_TYPES.REPORT,
      targetId: report.id,
      metadata: {
        name: params.name,
        sectionTypes: template.sections.map((section) => section.type),
      },
    });

    return report;
  }

  async list(params: {
    organizationId: string;
    limit?: number;
    offset?: number;
  }) {
    const { take, skip } = pageBounds(params);

    return this.prisma.report.findMany({
      where: { organizationId: params.organizationId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { runs: true } } },
      take,
      skip,
    });
  }

  async findOne(params: {
    organizationId: string;
    reportId: string;
  }): Promise<Report> {
    const report = await this.prisma.report.findFirst({
      where: { id: params.reportId, organizationId: params.organizationId },
    });
    if (!report) throw new NotFoundException('Informe no encontrado');

    return report;
  }

  async listRuns(params: {
    organizationId: string;
    reportId: string;
    limit?: number;
    offset?: number;
  }) {
    await this.findOne(params);
    const { take, skip } = pageBounds(params);

    return this.prisma.reportRun.findMany({
      where: { reportId: params.reportId },
      orderBy: { generatedAt: 'desc' },
      take,
      skip,
    });
  }

  async update(params: {
    organizationId: string;
    actorUserId: string;
    reportId: string;
    name?: string;
    template?: unknown;
  }): Promise<Report> {
    const existing = await this.findOne(params);
    const template =
      params.template !== undefined
        ? this.validate(params.template)
        : parseReportTemplate(existing.template);

    const updated = await this.prisma.report.update({
      where: { id: existing.id },
      data: {
        ...(params.name !== undefined ? { name: params.name } : {}),
        template: template as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.actorUserId,
      action: AUDIT_ACTIONS.REPORT_UPDATED,
      targetType: AUDIT_TARGET_TYPES.REPORT,
      targetId: existing.id,
      metadata: {
        sectionTypes: template.sections.map((section) => section.type),
      },
    });

    return updated;
  }

  async remove(params: {
    organizationId: string;
    actorUserId: string;
    reportId: string;
  }): Promise<{ id: string }> {
    const existing = await this.findOne(params);

    // El historial de generaciones cae con el informe por cascada. Es coherente: lo que se
    // conserva de cada generación es la traza de auditoría, que vive fuera y no se borra.
    await this.prisma.report.delete({ where: { id: existing.id } });

    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.actorUserId,
      action: AUDIT_ACTIONS.REPORT_DELETED,
      targetType: AUDIT_TARGET_TYPES.REPORT,
      targetId: existing.id,
      metadata: { name: existing.name },
    });

    return { id: existing.id };
  }

  /**
   * Genera el informe EN NOMBRE de una persona concreta.
   *
   * `actorUserId` nunca es opcional: de él sale el alcance, y de ahí la única garantía que
   * importa — el PDF no puede contener nada que esa persona no pudiera leer por HTTP. Bajo
   * demanda es quien lo pide; programado, quien creó la automatización.
   */
  async generate(params: {
    organizationId: string;
    actorUserId: string;
    reportId: string;
    /** Qué disparó la generación. Solo informativo, para la traza. */
    trigger: 'MANUAL' | 'AUTOMATION';
  }): Promise<GeneratedReport> {
    const report = await this.findOne(params);

    const run = await this.prisma.reportRun.create({
      data: { reportId: report.id, status: RunStatus.RUNNING },
      select: { id: true },
    });

    try {
      const composed = await this.composer.execute({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        template: report.template,
      });

      const organization = await this.prisma.organization.findFirstOrThrow({
        where: { id: params.organizationId },
        select: { name: true },
      });

      const content = await this.renderer.render({
        reportName: report.name,
        organizationName: organization.name,
        composed,
      });

      await this.prisma.reportRun.update({
        where: { id: run.id },
        data: {
          status: RunStatus.SUCCESS,
          // `fileUrl` queda NULO a propósito: el fichero no se almacena. Lo que se conserva
          // es con qué se hizo, para poder reproducirlo.
          fileUrl: null,
        },
      });

      // Qué se leyó exactamente. Es lo que convierte un PDF entregado y perdido en algo
      // todavía auditable: se puede saber qué contenía sin conservarlo.
      await this.audit.record({
        organizationId: params.organizationId,
        actorId: params.actorUserId,
        action: AUDIT_ACTIONS.REPORT_GENERATED,
        targetType: AUDIT_TARGET_TYPES.REPORT,
        targetId: report.id,
        metadata: {
          runId: run.id,
          trigger: params.trigger,
          scopeCollectionIds: composed.scopeCollectionIds,
          sections: composed.sections.map((section) => ({
            type: section.type,
            title: section.title,
            items: section.rows.length,
            evidence: section.evidence,
          })),
          bytes: content.length,
          storedFile: false,
          externalActionExecuted: false,
        },
      });

      return {
        runId: run.id,
        fileName: this.fileNameFor(report.name),
        content,
        format: report.format,
      };
    } catch (error) {
      const message = (error as Error).message;
      await this.prisma.reportRun.update({
        where: { id: run.id },
        data: { status: RunStatus.FAILED, error: message },
      });
      this.logger.warn(
        `Generación del informe ${report.id} fallida: ${message}`,
      );
      throw error;
    }
  }

  private validate(raw: unknown) {
    try {
      return parseReportTemplate(raw);
    } catch (error) {
      if (error instanceof InvalidReportTemplateError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /** Nombre de fichero seguro: lo que llega del usuario no viaja tal cual a una cabecera. */
  private fileNameFor(name: string): string {
    const safe = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9-_ ]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60);

    return `${safe || 'informe'}-${new Date().toISOString().slice(0, 10)}.pdf`;
  }
}

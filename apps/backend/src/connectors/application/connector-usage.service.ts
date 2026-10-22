import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { dayWindow } from '../../llm/domain/ai-budget';
import {
  CONNECTOR_EVENTS_METRIC,
  dailyEventLimitFrom,
  remainingToday,
} from '../domain/connector-budget';

export interface BudgetStatus {
  limit: number;
  used: number;
  remaining: number;
  exhausted: boolean;
}

/**
 * Lleva la cuenta de cuántos hechos ha traído hoy cada empresa, y frena cuando se pasa.
 *
 * Reutiliza `dayWindow` del techo de IA a propósito: dos ventanas distintas para dos topes de
 * la misma empresa serían imposibles de explicar —«el de IA se renueva a medianoche y el otro
 * no»— y el día natural ya se eligió porque es lo que una persona entiende sin que nadie se
 * lo explique.
 *
 * ## Se comprueba ANTES y se apunta DESPUÉS
 *
 * Igual que el techo de IA, y por lo mismo: comprobar después sería contar lo ya gastado, y
 * apuntar por adelantado dejaría a la empresa consumiendo cupo por hechos que no llegaron a
 * escribirse.
 *
 * ## Apuntar no puede romper nada
 *
 * Si falla la escritura del contador, los hechos ya están escritos: propagar el error
 * convertiría en fallo una sincronización correcta, y además la haría reintentarse, duplicando
 * el trabajo. Se registra y se sigue. El precio es un hueco en la cuenta.
 */
@Injectable()
export class ConnectorUsageService {
  private readonly logger = new Logger(ConnectorUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Cuánto le queda hoy a esta empresa. No lanza: quien llama decide qué hacer. */
  async status(
    organizationId: string,
    now = new Date(),
  ): Promise<BudgetStatus> {
    const { start } = dayWindow(now);

    const [organization, consumido] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { settings: true },
      }),
      this.prisma.usageRecord.findFirst({
        where: {
          organizationId,
          metric: CONNECTOR_EVENTS_METRIC,
          periodStart: start,
        },
        select: { value: true },
      }),
    ]);

    const limit = dailyEventLimitFrom(organization?.settings ?? null);
    const used = consumido?.value ?? 0;

    return {
      limit,
      used,
      remaining: remainingToday(limit, used),
      exhausted: used >= limit,
    };
  }

  /**
   * Apunta los hechos escritos.
   *
   * `upsert` sobre la unicidad `(organizationId, metric, periodStart)` que ya existe: sin
   * ella, dos sincronizaciones simultáneas de la misma empresa crearían dos filas del mismo
   * día y el tope se contaría por la mitad.
   */
  async record(
    organizationId: string,
    events: number,
    now = new Date(),
  ): Promise<void> {
    if (events <= 0) return;

    const { start, end } = dayWindow(now);

    try {
      await this.prisma.usageRecord.upsert({
        where: {
          organizationId_metric_periodStart: {
            organizationId,
            metric: CONNECTOR_EVENTS_METRIC,
            periodStart: start,
          },
        },
        create: {
          organizationId,
          metric: CONNECTOR_EVENTS_METRIC,
          value: events,
          periodStart: start,
          periodEnd: end,
        },
        // Incremento, no asignación: dos sincronizaciones del mismo día suman.
        update: { value: { increment: events } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        this.logger.warn(
          `No se pudo apuntar el consumo de ${events} hechos de la organización ` +
            `${organizationId}: ${error.message}`,
        );
        return;
      }
      throw error;
    }
  }
}

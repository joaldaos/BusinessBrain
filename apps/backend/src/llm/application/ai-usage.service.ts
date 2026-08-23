import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AI_CHARACTERS_METRIC,
  dailyCharacterLimitFrom,
  dayWindow,
} from '../domain/ai-budget';

/**
 * Lleva la cuenta de cuánto texto ha mandado hoy cada empresa a su proveedor de IA, y frena
 * cuando se pasa del techo.
 *
 * ## Se comprueba ANTES y se apunta DESPUÉS
 *
 * Antes, porque el objetivo es no gastar; comprobar después sería contar el dinero ya gastado.
 * Después, porque apuntar por adelantado una llamada que luego falla dejaría a la empresa
 * pagando —en cupo— por algo que no llegó a ocurrir.
 *
 * La consecuencia es que una empresa puede pasarse un poco: la llamada que cruza el umbral se
 * ejecuta entera. Es deliberado. Cortar una vectorización a la mitad dejaría un documento a
 * medio indexar, que es un estado peor que unos cuantos miles de caracteres de más.
 *
 * ## Apuntar no puede romper nada
 *
 * Si falla la escritura del contador, la respuesta ya está dada: propagar el error convertiría
 * en fallo una operación correcta. Se registra y se sigue, igual que la auditoría. El precio
 * es un hueco en la cuenta; el precio de lo contrario sería una pregunta perdida.
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ¿Puede esta empresa seguir gastando hoy?
   *
   * Lanza si no. El mensaje va dirigido a una PYME: dice qué ha pasado, cuándo se arregla solo
   * y qué puede hacer mientras tanto, sin hablar de cuotas, métricas ni ventanas.
   */
  async assertWithinBudget(organizationId: string): Promise<void> {
    const { start } = dayWindow(new Date());

    const [organization, gastado] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { settings: true },
      }),
      this.prisma.usageRecord.findFirst({
        where: {
          organizationId,
          metric: AI_CHARACTERS_METRIC,
          periodStart: start,
        },
        select: { value: true },
      }),
    ]);

    // Una organización que ya no existe no puede gastar. Que lo resuelva quien llame.
    if (!organization) return;

    const limite = dailyCharacterLimitFrom(organization.settings);
    if ((gastado?.value ?? 0) < limite) return;

    throw new ForbiddenException(
      'Has alcanzado el máximo de uso de inteligencia artificial para hoy. Es un tope de ' +
        'seguridad para que no te lleves un susto con la factura de tu proveedor. Mañana ' +
        'vuelve a estar disponible; si necesitas más, un administrador puede subirlo desde ' +
        'Configuración.',
    );
  }

  /**
   * Apunta lo gastado.
   *
   * El incremento es atómico en la base de datos (`increment`), no una lectura seguida de una
   * escritura: varias vectorizaciones simultáneas de la misma empresa es el caso normal, y
   * leer-sumar-guardar perdería la mitad de las cuentas.
   */
  async record(organizationId: string, characters: number): Promise<void> {
    if (characters <= 0) return;
    const { start, end } = dayWindow(new Date());

    try {
      await this.prisma.usageRecord.upsert({
        where: {
          organizationId_metric_periodStart: {
            organizationId,
            metric: AI_CHARACTERS_METRIC,
            periodStart: start,
          },
        },
        create: {
          organizationId,
          metric: AI_CHARACTERS_METRIC,
          value: characters,
          periodStart: start,
          periodEnd: end,
        },
        update: { value: { increment: characters } },
      });
    } catch (error) {
      this.logger.error(
        `No se pudo apuntar el uso de IA de la organización ${organizationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Lo gastado hoy y el techo, para poder enseñarlo en la interfaz. */
  async todayFor(
    organizationId: string,
  ): Promise<{ used: number; limit: number }> {
    const { start } = dayWindow(new Date());

    const [organization, gastado] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { settings: true },
      }),
      this.prisma.usageRecord.findFirst({
        where: {
          organizationId,
          metric: AI_CHARACTERS_METRIC,
          periodStart: start,
        },
        select: { value: true },
      }),
    ]);

    return {
      used: gastado?.value ?? 0,
      limit: dailyCharacterLimitFrom(organization?.settings ?? null),
    };
  }
}

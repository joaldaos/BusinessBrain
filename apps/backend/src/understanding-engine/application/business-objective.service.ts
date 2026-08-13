import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BusinessObjectiveOrigin,
  BusinessObjectiveStatus,
  type BusinessObjective,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Ciclo de vida de `BusinessObjective` — UNDERSTANDING_ENGINE_DESIGN.md §3.6, §12.
 *
 * El Understanding Engine posee el ciclo de vida OPERATIVO (declaración, inferencia de
 * candidatos, confirmación) pero NUNCA la decisión de qué objetivo es válido: esa decisión
 * es siempre humana. Un candidato inferido jamás se auto-confirma.
 */
@Injectable()
export class BusinessObjectiveService {
  private readonly logger = new Logger(BusinessObjectiveService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Declara un objetivo nuevo (§12, `DeclareBusinessObjective`).
   *
   * Una declaración manual explícita nace `CONFIRMED`: es una persona la que respalda el
   * objetivo desde el origen. Un candidato producido por inferencia automática nace
   * `INFERRED` con confianza reducida, y no puede sostener un juicio de valor hasta que
   * alguien lo confirme.
   */
  async declare(params: {
    organizationId: string;
    statement: string;
    description?: string;
    origin: BusinessObjectiveOrigin;
    /** Obligatorio para una declaración manual: quién respalda el objetivo. */
    actorUserId?: string;
  }): Promise<BusinessObjective> {
    const isManual =
      params.origin === BusinessObjectiveOrigin.MANUAL_DECLARATION;

    if (isManual && !params.actorUserId) {
      // Falta un dato de la petición, no hay avería: 400, no 500.
      throw new BadRequestException(
        'Una declaración manual exige identificar a la persona que respalda el objetivo',
      );
    }

    return this.prisma.businessObjective.create({
      data: {
        organizationId: params.organizationId,
        statement: params.statement,
        description: params.description ?? null,
        origin: params.origin,
        status: isManual
          ? BusinessObjectiveStatus.CONFIRMED
          : BusinessObjectiveStatus.INFERRED,
        confidence: isManual ? 1 : 0.5,
        confirmedById: isManual ? params.actorUserId : null,
        confirmedAt: isManual ? new Date() : null,
      },
    });
  }

  /**
   * Promueve un candidato `INFERRED` a `CONFIRMED` (§12, `ConfirmBusinessObjective`).
   *
   * Única operación que habilita a un objetivo para sostener un `RISK`/`OPPORTUNITY`.
   * Siempre disparada por acción humana explícita: no existe ninguna vía automática.
   */
  async confirm(params: {
    organizationId: string;
    businessObjectiveId: string;
    actorUserId: string;
  }): Promise<BusinessObjective> {
    const objective = await this.prisma.businessObjective.findFirst({
      where: {
        id: params.businessObjectiveId,
        organizationId: params.organizationId,
      },
    });
    if (!objective)
      throw new NotFoundException('BusinessObjective no encontrado');

    if (objective.status === BusinessObjectiveStatus.DISCARDED) {
      // Conflicto con el ESTADO del recurso: la misma llamada sería válida sobre un
      // objetivo no descartado.
      throw new ConflictException(
        'Un objetivo descartado no se confirma: debe declararse de nuevo si vuelve a importar',
      );
    }

    return this.prisma.businessObjective.update({
      where: { id: objective.id },
      data: {
        status: BusinessObjectiveStatus.CONFIRMED,
        confidence: 1,
        confirmedById: params.actorUserId,
        confirmedAt: new Date(),
      },
    });
  }

  async discard(params: {
    organizationId: string;
    businessObjectiveId: string;
    actorUserId: string;
  }): Promise<BusinessObjective> {
    const objective = await this.prisma.businessObjective.findFirst({
      where: {
        id: params.businessObjectiveId,
        organizationId: params.organizationId,
      },
    });
    if (!objective)
      throw new NotFoundException('BusinessObjective no encontrado');

    return this.prisma.businessObjective.update({
      where: { id: objective.id },
      data: { status: BusinessObjectiveStatus.DISCARDED },
    });
  }

  /**
   * Versiona un objetivo: no se edita en sitio (§3.6). El estado de la versión nueva depende
   * del ORIGEN del cambio, sin excepción:
   *
   * - Edición manual explícita → conserva `CONFIRMED`. Sigue siendo una persona la que
   *   respalda el objetivo; solo cambió su redacción o su valor.
   * - Re-inferencia automática → nace `INFERRED`, **incluso si reemplaza a una versión
   *   confirmada**. Ninguna confirmación humana se hereda a un contenido que esa persona
   *   nunca llegó a ver ni aprobar.
   */
  async createNewVersion(params: {
    organizationId: string;
    businessObjectiveId: string;
    statement: string;
    description?: string;
    origin: BusinessObjectiveOrigin;
    actorUserId?: string;
  }): Promise<BusinessObjective> {
    const previous = await this.prisma.businessObjective.findFirst({
      where: {
        id: params.businessObjectiveId,
        organizationId: params.organizationId,
      },
    });
    if (!previous)
      throw new NotFoundException('BusinessObjective no encontrado');

    const isManual =
      params.origin === BusinessObjectiveOrigin.MANUAL_DECLARATION;

    if (isManual && !params.actorUserId) {
      throw new BadRequestException(
        'Una edición manual exige identificar a la persona que respalda la nueva versión',
      );
    }

    const inheritsConfirmation =
      isManual && previous.status === BusinessObjectiveStatus.CONFIRMED;

    return this.prisma.businessObjective.create({
      data: {
        organizationId: params.organizationId,
        statement: params.statement,
        description: params.description ?? null,
        origin: params.origin,
        status: inheritsConfirmation
          ? BusinessObjectiveStatus.CONFIRMED
          : BusinessObjectiveStatus.INFERRED,
        confidence: inheritsConfirmation ? 1 : 0.5,
        confirmedById: inheritsConfirmation ? params.actorUserId : null,
        confirmedAt: inheritsConfirmation ? new Date() : null,
        supersedesObjectiveId: previous.id,
      },
    });
  }

  /**
   * Catálogo de objetivos de la organización — subfase 6.1.
   *
   * Incluye TODOS los estados a propósito: sin ver los `INFERRED` no habría forma de
   * confirmarlos, y sin ver los `DISCARDED` no habría forma de entender por qué el sistema
   * dejó de considerar algo que antes importaba.
   *
   * Por defecto solo devuelve la cabeza de cada cadena de versiones: una lista que mezclara
   * versiones superadas con vigentes haría imposible saber qué le importa hoy a la empresa.
   */
  async list(params: {
    organizationId: string;
    status?: BusinessObjectiveStatus;
    includeSuperseded?: boolean;
    limit: number;
    offset: number;
  }): Promise<BusinessObjective[]> {
    return this.prisma.businessObjective.findMany({
      where: {
        organizationId: params.organizationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.includeSuperseded ? {} : { supersededBy: { is: null } }),
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      skip: params.offset,
    });
  }

  /** Un objetivo de la propia organización. Fuera de ella, no existe. */
  async findOne(params: {
    organizationId: string;
    businessObjectiveId: string;
  }): Promise<BusinessObjective> {
    const objective = await this.prisma.businessObjective.findFirst({
      where: {
        id: params.businessObjectiveId,
        organizationId: params.organizationId,
      },
    });
    if (!objective) {
      throw new NotFoundException('BusinessObjective no encontrado');
    }

    return objective;
  }

  /**
   * Objetivos que pueden anclar un juicio de valor: confirmados Y vigentes.
   *
   * La vigencia no es un estado (§3.6): se deriva de ser la versión más reciente de su
   * cadena, es decir, de que ninguna otra versión la haya superado.
   */
  async listConfirmedAndCurrent(
    organizationId: string,
  ): Promise<BusinessObjective[]> {
    return this.prisma.businessObjective.findMany({
      where: {
        organizationId,
        status: BusinessObjectiveStatus.CONFIRMED,
        // Sin sucesor: es la cabeza de su cadena de versiones.
        supersededBy: { is: null },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

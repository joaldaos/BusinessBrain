import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';

/**
 * Borrar los datos de la empresa.
 *
 * ## Se borra de verdad
 *
 * No se marca como inactiva ni se esconde de los listados: se borra la organización y la
 * cascada del esquema se lleva documentos, colecciones, conclusiones, recomendaciones,
 * conversaciones, informes, integraciones y la configuración de IA. Un borrado que en realidad
 * oculta es una respuesta falsa a quien ejerce su derecho a que le borren.
 *
 * ## Lo que NO se borra, y por qué
 *
 * Las CUENTAS de las personas. Alguien puede pertenecer a dos empresas, y borrar su usuario al
 * cerrar una le echaría de la otra. Lo que desaparece es su pertenencia a esta. Una cuenta que
 * se queda sin ninguna empresa sigue existiendo y sin acceso a nada: borrarla es otra decisión,
 * de la persona y no de la empresa, y todavía no está resuelta.
 *
 * ## La traza tiene que sobrevivir al borrado
 *
 * `AuditLog` cuelga de la organización en cascada: una entrada escrita con su
 * `organizationId` se borraría con ella y no quedaría constancia de nada. Por eso el registro
 * del borrado se escribe SIN organización, con el identificador y el nombre en los metadatos.
 * Es la única entrada del sistema que se escribe así, y tiene que serlo.
 *
 * ## Por qué hay que escribir el nombre de la empresa
 *
 * Es irreversible y no hay papelera. Pedir que se teclee el nombre convierte un clic en un
 * acto deliberado; sin eso, el botón está a un despiste de distancia.
 */
@Injectable()
export class OrganizationErasureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async erase(params: {
    organizationId: string;
    actorId: string;
    /** El nombre tal y como lo tiene que teclear quien borra. */
    confirmationName: string;
  }): Promise<{ deleted: true }> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: params.organizationId },
      select: { id: true, name: true },
    });

    if (params.confirmationName.trim() !== organization.name) {
      throw new BadRequestException(
        'Para borrar los datos hay que escribir el nombre de la empresa exactamente igual.',
      );
    }

    const [documentos, conversaciones, conclusiones, recomendaciones] =
      await Promise.all([
        this.prisma.knowledgeItem.count({
          where: { organizationId: organization.id },
        }),
        this.prisma.conversation.count({
          where: { organizationId: organization.id },
        }),
        this.prisma.insight.count({
          where: { organizationId: organization.id },
        }),
        this.prisma.recommendation.count({
          where: { organizationId: organization.id },
        }),
      ]);

    await this.prisma.organization.delete({ where: { id: organization.id } });

    // SIN `organizationId`: con él, esta misma entrada se habría borrado en la cascada.
    await this.audit.record({
      organizationId: null,
      actorId: params.actorId,
      action: AUDIT_ACTIONS.ORGANIZATION_DATA_ERASED,
      targetType: AUDIT_TARGET_TYPES.ORGANIZATION,
      targetId: organization.id,
      metadata: {
        nombre: organization.name,
        documentos,
        conversaciones,
        conclusiones,
        recomendaciones,
      },
    });

    return { deleted: true };
  }
}

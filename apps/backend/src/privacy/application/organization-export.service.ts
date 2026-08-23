import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';

/**
 * Llevarse los datos de la empresa.
 *
 * ## Por qué es del PROPIETARIO y no de cualquiera con acceso
 *
 * El resto del producto entrega comprensión acotada por colección: cada persona ve lo que le
 * han concedido, y el acceso parcial deniega. Esto es otra cosa. No es "leer conocimiento": es
 * un acto administrativo de la empresa sobre sus propios datos, el equivalente a pedirle a un
 * proveedor una copia de lo que guarda de ti.
 *
 * Por eso lo puede hacer únicamente quien responde por la empresa —el propietario, ni siquiera
 * un administrador— y por eso queda registrado en la auditoría con el recuento de lo que se
 * llevó. La alternativa, acotarlo por colección, produciría una copia incompleta que no serviría
 * ni para migrar ni para responder a nadie, y el propietario podría concederse el acceso que le
 * faltara en dos clics de todas formas.
 *
 * ## Lo que NUNCA sale
 *
 * Los secretos. La clave del proveedor de IA, la configuración cifrada de las fuentes, los
 * testigos de invitación y los de las claves de API se quedan fuera. Una copia de seguridad
 * para el cliente no tiene por qué llevar material con el que suplantar a su empresa, y un
 * fichero así acaba en un correo o en un disco compartido.
 */
@Injectable()
export class OrganizationExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async export(organizationId: string, actorId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        settings: true,
        createdAt: true,
      },
    });

    const [
      personas,
      colecciones,
      fuentes,
      documentos,
      conclusiones,
      recomendaciones,
      conversaciones,
      informes,
      objetivos,
    ] = await Promise.all([
      this.prisma.membership.findMany({
        where: { organizationId },
        select: {
          role: true,
          joinedAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
      this.prisma.knowledgeCollection.findMany({
        where: { organizationId },
        select: { id: true, name: true, description: true, createdAt: true },
      }),
      this.prisma.knowledgeSource.findMany({
        where: { organizationId },
        // `configEnc` NO: es la configuración cifrada, con credenciales dentro.
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          createdAt: true,
          lastSyncedAt: true,
        },
      }),
      this.prisma.knowledgeItem.findMany({
        where: { organizationId },
        select: {
          id: true,
          title: true,
          contentText: true,
          status: true,
          businessArea: true,
          confidenceScore: true,
          indexedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.insight.findMany({
        where: { organizationId },
        select: {
          id: true,
          type: true,
          summary: true,
          status: true,
          confidence: true,
          createdAt: true,
        },
      }),
      this.prisma.recommendation.findMany({
        where: { organizationId },
        select: {
          id: true,
          title: true,
          status: true,
          detected: true,
          justification: true,
          createdAt: true,
          resolvedAt: true,
        },
      }),
      this.prisma.conversation.findMany({
        where: { organizationId },
        select: {
          id: true,
          title: true,
          createdAt: true,
          messages: {
            select: { role: true, content: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      this.prisma.report.findMany({
        where: { organizationId },
        select: { id: true, name: true, createdAt: true },
      }),
      this.prisma.businessObjective.findMany({
        where: { organizationId },
        select: { id: true, statement: true, status: true, createdAt: true },
      }),
    ]);

    const contenido = {
      // Quién generó esto y cuándo: sin eso, el fichero no se puede fechar dentro de un año.
      exportadoEl: new Date().toISOString(),
      empresa: organization,
      personas,
      colecciones,
      fuentes,
      documentos,
      conclusiones,
      recomendaciones,
      conversaciones,
      informes,
      objetivos,
    };

    // La traza guarda el RECUENTO, no el contenido: una auditoría que copiara los datos
    // exportados duplicaría exactamente lo que se está intentando controlar.
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.ORGANIZATION_DATA_EXPORTED,
      targetType: AUDIT_TARGET_TYPES.ORGANIZATION,
      targetId: organizationId,
      metadata: {
        documentos: documentos.length,
        conversaciones: conversaciones.length,
        conclusiones: conclusiones.length,
        recomendaciones: recomendaciones.length,
        personas: personas.length,
      },
    });

    return contenido;
  }
}

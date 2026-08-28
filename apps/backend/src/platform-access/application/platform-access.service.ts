import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MembershipRole,
  PlatformAccessScope,
  PlatformAccessStatus,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import {
  DENIAL_MESSAGES,
  evaluateGrant,
  pendingApprovalExpiry,
  requiresOwnerApproval,
  resolveExpiry,
} from '../domain/platform-access';

/**
 * El acceso administrativo a los datos de una empresa: pedirlo, aprobarlo, usarlo y retirarlo.
 *
 * ## La regla que ordena todo esto
 *
 * **Administrar BusinessBrain no es ser superusuario de los datos de los clientes.** Sin una
 * concesión explícita, motivada y con fecha de fin, la respuesta a cualquier consulta sobre una
 * empresa es la misma que le daríamos a un desconocido. El rol de plataforma abre la puerta de
 * la operación, no la de los negocios ajenos.
 *
 * ## Y por qué una concesión no es —ni puede ser— una membresía
 *
 * `PlatformAccessGrant` cuelga de `User` y de `Organization` por separado, nunca de
 * `Membership`. No es una preferencia de modelado: quien administra la plataforma **no tiene
 * membresías** por invariante, así que la concesión tenía que vivir en otro sitio o no existir.
 * La consecuencia es que no hay forma de que un acceso temporal se convierta en pertenencia:
 * son dos tablas de forma distinta y ninguna ruta de cliente mira esta.
 *
 * Una concesión tampoco abre ninguna ruta de tenant. Abre rutas de PLATAFORMA, que devuelven lo
 * que su alcance permite y nada más. El aislamiento entre organizaciones no se toca porque no
 * hay nada que puentear.
 */
@Injectable()
export class PlatformAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Pedir acceso a una empresa.
   *
   * Metadatos y diagnóstico nacen utilizables: son operación, y hacer esperar a quien está
   * investigando una incidencia por datos que no son contenido sería fricción sin garantía.
   * El contenido nace PENDIENTE — ahí decide el propietario, no nosotros.
   */
  async request(params: {
    organizationId: string;
    requestedById: string;
    scope: PlatformAccessScope;
    reason: string;
    hours?: number;
  }) {
    const motivo = params.reason.trim();
    if (motivo.length === 0) {
      // Un acceso sin motivo no se puede auditar después: la traza diría que alguien miró y
      // no por qué, que es la mitad de la pregunta.
      throw new BadRequestException(
        'Hace falta explicar por qué se necesita este acceso.',
      );
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: params.organizationId },
      select: { id: true, name: true },
    });
    if (!organization) {
      throw new NotFoundException('Organización no encontrada');
    }

    const necesitaAprobacion = requiresOwnerApproval(params.scope);
    const grant = await this.prisma.platformAccessGrant.create({
      data: {
        organizationId: organization.id,
        scope: params.scope,
        reason: motivo,
        requestedById: params.requestedById,
        status: necesitaAprobacion
          ? PlatformAccessStatus.PENDING
          : PlatformAccessStatus.ACTIVE,
        // Una petición sin aprobar también caduca: si no, podría aprobarse meses después,
        // cuando el motivo que la justificaba ya no existe.
        expiresAt: necesitaAprobacion
          ? pendingApprovalExpiry()
          : resolveExpiry(params.scope, params.hours),
      },
    });

    await this.record(AUDIT_ACTIONS.PLATFORM_ACCESS_REQUESTED, {
      actorId: params.requestedById,
      grantId: grant.id,
      organization,
      metadata: {
        scope: params.scope,
        reason: motivo,
        requiresApproval: necesitaAprobacion,
        expiresAt: grant.expiresAt.toISOString(),
      },
    });

    return this.present(grant);
  }

  /**
   * El propietario aprueba un acceso a su contenido.
   *
   * Solo el propietario, solo de su empresa, y solo peticiones de contenido pendientes. El
   * plazo empieza a contar AQUÍ y no cuando se pidió: aprobar una petición de hace dos días no
   * puede regalar dos días menos de acceso ni dejarla caducada al instante.
   */
  async approve(params: {
    grantId: string;
    organizationId: string;
    ownerUserId: string;
    hours?: number;
  }) {
    const grant = await this.findInOrganization(
      params.grantId,
      params.organizationId,
    );

    if (grant.status !== PlatformAccessStatus.PENDING) {
      throw new BadRequestException(
        'Esta petición ya no está pendiente de tu decisión.',
      );
    }
    if (grant.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Esta petición ha caducado. Pide a BusinessBrain que la vuelva a solicitar.',
      );
    }

    // Transición CONDICIONAL, no lectura seguida de escritura: dos aprobaciones simultáneas
    // de la misma petición dejarían dos plazos distintos si se comprobara y luego se
    // escribiera. Aquí solo una encuentra la fila pendiente.
    const [marcada] = await this.prisma.$transaction([
      this.prisma.platformAccessGrant.updateMany({
        where: { id: grant.id, status: PlatformAccessStatus.PENDING },
        data: {
          status: PlatformAccessStatus.ACTIVE,
          approvedById: params.ownerUserId,
          approvedAt: new Date(),
          expiresAt: resolveExpiry(grant.scope, params.hours),
        },
      }),
    ]);

    if (marcada.count === 0) {
      throw new BadRequestException(
        'Esta petición ya no está pendiente de tu decisión.',
      );
    }

    const actualizada = await this.prisma.platformAccessGrant.findUniqueOrThrow(
      {
        where: { id: grant.id },
        include: { organization: { select: { id: true, name: true } } },
      },
    );

    await this.record(AUDIT_ACTIONS.PLATFORM_ACCESS_APPROVED, {
      actorId: params.ownerUserId,
      grantId: grant.id,
      organization: actualizada.organization,
      metadata: {
        scope: grant.scope,
        reason: grant.reason,
        requestedById: grant.requestedById,
        expiresAt: actualizada.expiresAt.toISOString(),
      },
    });

    return this.present(actualizada);
  }

  /**
   * Retirar un acceso antes de que caduque.
   *
   * Lo puede hacer quien lo pidió —la administración— y quien lo aprobó: son los datos del
   * cliente, y una aprobación que no se puede retirar es un permiso permanente hasta la fecha
   * de fin. Nadie más: ni otro administrador, ni otro miembro de la empresa.
   */
  async revoke(params: { grantId: string; actorId: string }) {
    const grant = await this.prisma.platformAccessGrant.findUnique({
      where: { id: params.grantId },
      include: { organization: { select: { id: true, name: true } } },
    });
    if (!grant) throw new NotFoundException('Acceso no encontrado');

    const puedeRetirar =
      grant.requestedById === params.actorId ||
      grant.approvedById === params.actorId;
    if (!puedeRetirar) {
      throw new ForbiddenException(
        'Solo puede retirar este acceso quien lo pidió o quien lo aprobó.',
      );
    }

    if (grant.status === PlatformAccessStatus.REVOKED) {
      return this.present(grant);
    }

    await this.prisma.platformAccessGrant.update({
      where: { id: grant.id },
      data: {
        status: PlatformAccessStatus.REVOKED,
        revokedById: params.actorId,
        revokedAt: new Date(),
      },
    });

    await this.record(AUDIT_ACTIONS.PLATFORM_ACCESS_REVOKED, {
      actorId: params.actorId,
      grantId: grant.id,
      organization: grant.organization,
      metadata: {
        scope: grant.scope,
        // Quién lo retira importa: no es lo mismo que la administración cierre un acceso que
        // ya no necesita a que el cliente lo corte.
        revokedByRequester: grant.requestedById === params.actorId,
      },
    });

    return this.present({
      ...grant,
      status: PlatformAccessStatus.REVOKED,
      revokedAt: new Date(),
    });
  }

  /**
   * La puerta: ¿puede esta persona de plataforma consultar esto de esta empresa, ahora?
   *
   * Deniega por defecto. Se busca una concesión de ESE alcance y de ESA persona; el resto de
   * combinaciones no existen para efectos de esta comprobación. Y cada uso autorizado queda
   * registrado: sin eso, la traza diría que hubo permiso y no cuántas veces se ejerció, que es
   * justo lo que hay que poder responderle a un cliente.
   */
  async assertUsable(params: {
    organizationId: string;
    adminId: string;
    scope: PlatformAccessScope;
    /** Qué se consultó, para la traza. Nunca contenido: el nombre de la consulta. */
    what: string;
  }): Promise<void> {
    const grant = await this.prisma.platformAccessGrant.findFirst({
      where: {
        organizationId: params.organizationId,
        scope: params.scope,
        requestedById: params.adminId,
      },
      orderBy: { createdAt: 'desc' },
      include: { organization: { select: { id: true, name: true } } },
    });

    const decision = evaluateGrant(grant, {
      scope: params.scope,
      adminId: params.adminId,
    });

    if (!decision.allowed) {
      throw new ForbiddenException(DENIAL_MESSAGES[decision.reason]);
    }

    await this.record(AUDIT_ACTIONS.PLATFORM_ACCESS_USED, {
      actorId: params.adminId,
      grantId: grant!.id,
      organization: grant!.organization,
      metadata: { scope: params.scope, what: params.what },
    });
  }

  /** Los accesos a una empresa. Lo consulta la administración y también el cliente. */
  async listForOrganization(organizationId: string) {
    const grants = await this.prisma.platformAccessGrant.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: {
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        revokedBy: { select: { id: true, name: true } },
      },
    });

    return grants.map((grant) => this.present(grant));
  }

  /**
   * Los accesos que ESTE administrador tiene o ha tenido, en todas las empresas.
   *
   * Existe para que quien administra pueda responderse "¿qué tengo abierto ahora mismo?" sin
   * recorrer empresa por empresa — que es la pregunta que hay que poder contestar antes de
   * pedir una concesión más, y la que lleva a retirar las que ya no hacen falta.
   *
   * Acotado a quien pregunta, y no a "todas las concesiones de la plataforma": ver los accesos
   * ajenos no ayuda a nadie a operar y sí dibujaría el mapa de qué clientes está mirando cada
   * cual. Cada concesión es de quien la pidió, también para leerla.
   *
   * Lleva el nombre de la empresa porque un listado de identificadores no se puede usar.
   */
  async listForAdmin(adminId: string) {
    const grants = await this.prisma.platformAccessGrant.findMany({
      where: { requestedById: adminId },
      orderBy: { createdAt: 'desc' },
      include: {
        organization: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        revokedBy: { select: { id: true, name: true } },
      },
    });

    return grants.map((grant) => ({
      ...this.present(grant),
      organization: grant.organization,
    }));
  }

  private async findInOrganization(grantId: string, organizationId: string) {
    const grant = await this.prisma.platformAccessGrant.findFirst({
      where: { id: grantId, organizationId },
    });
    // Se busca acotado por organización a propósito: preguntar por una concesión de otra
    // empresa devuelve "no encontrada", no "no es tuya". La diferencia permitiría enumerar.
    if (!grant) throw new NotFoundException('Acceso no encontrado');
    return grant;
  }

  private async record(
    action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
    params: {
      actorId: string;
      grantId: string;
      organization: { id: string; name: string };
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    // SIN `organizationId`: la traza de plataforma tiene que sobrevivir al borrado de la
    // empresa, que es justo cuando hay que poder demostrar a qué se accedió.
    await this.audit.record({
      organizationId: null,
      actorId: params.actorId,
      action,
      targetType: AUDIT_TARGET_TYPES.PLATFORM_ACCESS_GRANT,
      targetId: params.grantId,
      metadata: {
        organizationId: params.organization.id,
        organizationName: params.organization.name,
        ...params.metadata,
      },
    });
  }

  /**
   * Cómo se presenta una concesión.
   *
   * `expired` se deriva del reloj y no se guarda: un estado almacenado exigiría un proceso que
   * lo actualizara, y entre el vencimiento y ese proceso habría una ventana con el acceso
   * todavía abierto.
   */
  private present(grant: {
    id: string;
    organizationId: string;
    scope: PlatformAccessScope;
    status: PlatformAccessStatus;
    reason: string;
    requestedById: string;
    createdAt: Date;
    approvedAt?: Date | null;
    revokedAt?: Date | null;
    expiresAt: Date;
    requestedBy?: { id: string; name: string } | null;
    approvedBy?: { id: string; name: string } | null;
    revokedBy?: { id: string; name: string } | null;
  }) {
    const caducada = grant.expiresAt.getTime() <= Date.now();

    return {
      id: grant.id,
      organizationId: grant.organizationId,
      scope: grant.scope,
      status: grant.status,
      expired: caducada,
      usable: grant.status === PlatformAccessStatus.ACTIVE && !caducada,
      reason: grant.reason,
      requestedBy: grant.requestedBy ?? { id: grant.requestedById, name: '' },
      approvedBy: grant.approvedBy ?? null,
      revokedBy: grant.revokedBy ?? null,
      createdAt: grant.createdAt.toISOString(),
      approvedAt: grant.approvedAt?.toISOString() ?? null,
      revokedAt: grant.revokedAt?.toISOString() ?? null,
      expiresAt: grant.expiresAt.toISOString(),
    };
  }
}

/** El rol que puede aprobar y retirar accesos al contenido de una empresa. */
export const APPROVER_ROLE = MembershipRole.OWNER;

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../audit/domain/audit-actions';
import type { PlanTier } from '@businessbrain/database';

const PAGE_SIZE = 20;

// page=abc en la query string llega como NaN tras Number(); sin este guard, Prisma
// recibiría un `skip` inválido y respondería con un 500 en vez de simplemente usar la página 1.
function normalizePage(page?: number): number {
  return Number.isInteger(page) && (page as number) > 0 ? (page as number) : 1;
}

/**
 * Administración de plataforma.
 *
 * ## La regla que ordena todo este servicio
 *
 * Quien opera BusinessBrain ve **metadatos y agregados**, nunca el contenido de un cliente.
 * Cuántos documentos tiene una empresa es operación; qué dicen esos documentos es su negocio.
 * La frontera no está en lo que sería útil sino en lo que corresponde: un administrador
 * necesita saber que una organización tiene 400 documentos y ninguna sincronización desde el
 * martes, y no necesita —ni debe— leer ninguno.
 *
 * ## Y las lecturas de datos personales sí se auditan
 *
 * El resto de listados son agregados de la propia plataforma. La lista de usuarios son nombres
 * y correos de empleados de empresas clientes: datos personales de terceros. Que mirarlos no
 * cambie nada no quita que haya que poder responder quién los miró y cuándo.
 *
 * ## Toda acción de plataforma se registra sin `organizationId`
 *
 * `AuditLog` cae en cascada con la organización. Registrar una acción administrativa con el
 * identificador de la empresa afectada la haría desaparecer al borrar esa empresa — y es
 * justamente entonces cuando hay que poder demostrar qué se hizo. La organización viaja en
 * `metadata`.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async stats() {
    const [totalUsers, totalOrganizations, bannedUsers, usersByPlan] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.organization.count(),
        this.prisma.user.count({ where: { status: 'BANNED' } }),
        this.prisma.organization.groupBy({ by: ['planTier'], _count: true }),
      ]);

    return {
      totalUsers,
      totalOrganizations,
      bannedUsers,
      organizationsByPlan: Object.fromEntries(
        usersByPlan.map((row) => [row.planTier, row._count]),
      ),
    };
  }

  /**
   * Las organizaciones, en metadatos.
   *
   * ## Por qué la selección es explícita
   *
   * Antes se devolvía la fila entera, y `settings` ha ido acumulando configuración del
   * cliente: su techo de gasto en IA, su exigencia de fiabilidad con las fuentes. Nada de eso
   * es secreto, pero tampoco es asunto de la plataforma sin una razón — y lo que iba a pasar
   * es lo que pasa siempre con un `findMany` sin `select`: el día que alguien guarde algo
   * sensible ahí, la administración lo estaría leyendo sin que nadie lo decidiera.
   *
   * Los recuentos sí: son la señal operativa que permite ver si una empresa está usando el
   * producto o si algo se ha atascado.
   */
  async listOrganizations(rawPage?: number) {
    const page = normalizePage(rawPage);
    const [items, total] = await Promise.all([
      this.prisma.organization.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          planTier: true,
          createdAt: true,
          _count: {
            select: {
              memberships: true,
              knowledgeItems: true,
              knowledgeSources: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.organization.count(),
    ]);
    return { items, total, page, pages: Math.ceil(total / PAGE_SIZE) };
  }

  /**
   * Las personas, con la lectura registrada.
   *
   * El correo se sigue devolviendo: sin él, un administrador no puede atender "no puedo entrar
   * con esta cuenta", que es el motivo por el que existe este listado. Lo que cambia es que
   * mirar deja rastro.
   *
   * La traza guarda cuántas se leyeron y en qué página, nunca quiénes: una auditoría que
   * copiara los correos sería un segundo almacén de los mismos datos personales, y el
   * problema que intenta controlar acabaría duplicado dentro de ella.
   */
  async listUsers(rawPage: number | undefined, actorId: string) {
    const page = normalizePage(rawPage);
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          platformRole: true,
          status: true,
          createdAt: true,
          lastActiveAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.user.count(),
    ]);

    await this.audit.record({
      organizationId: null,
      actorId,
      action: AUDIT_ACTIONS.PLATFORM_USERS_LISTED,
      targetType: AUDIT_TARGET_TYPES.USER,
      metadata: { page, returned: items.length },
    });

    return { items, total, page, pages: Math.ceil(total / PAGE_SIZE) };
  }

  async toggleUserBan(userId: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const nextStatus = user.status === 'BANNED' ? 'ACTIVE' : 'BANNED';
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: nextStatus },
    });

    await this.audit.record({
      organizationId: null,
      actorId,
      action:
        nextStatus === 'BANNED'
          ? AUDIT_ACTIONS.USER_BANNED
          : AUDIT_ACTIONS.USER_UNBANNED,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: userId,
      metadata: { previousStatus: user.status, newStatus: nextStatus },
    });

    return { id: updated.id, status: updated.status };
  }

  async changeOrganizationPlan(
    organizationId: string,
    planTier: PlanTier,
    actorId: string,
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization)
      throw new NotFoundException('Organización no encontrada');

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { planTier },
    });

    // SIN `organizationId`: con él, esta entrada se borraría el día que se borre la empresa,
    // que es justo cuando hace falta poder demostrar qué se le hizo.
    await this.audit.record({
      organizationId: null,
      actorId,
      action: AUDIT_ACTIONS.ORGANIZATION_PLAN_CHANGED,
      targetType: AUDIT_TARGET_TYPES.ORGANIZATION,
      targetId: organizationId,
      metadata: {
        organizationId,
        organizationName: organization.name,
        from: organization.planTier,
        to: planTier,
      },
    });

    return { id: updated.id, planTier: updated.planTier };
  }
}

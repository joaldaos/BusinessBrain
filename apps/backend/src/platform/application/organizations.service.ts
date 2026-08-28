import { Injectable, NotFoundException } from '@nestjs/common';
import type { PlanTier } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import { PAGE_SIZE, normalizePage, paginate } from '../domain/pagination';

/**
 * El CATÁLOGO de clientes: quiénes son, qué plan tienen, desde cuándo.
 *
 * ## Dónde está exactamente la frontera
 *
 * Esto NO es mirar dentro de una empresa. Es la lista de clientes de BusinessBrain, que es
 * información de nuestro propio negocio: a quién le facturamos, cuántos son, quién lleva dos
 * meses sin entrar. Un administrador que no puede ver su cartera de clientes no puede operar
 * el producto.
 *
 * Mirar DENTRO de una empresa —qué fuentes ha conectado, qué le falla, qué dicen sus
 * documentos— es otra cosa y vive en otro sitio: `OrganizationInspectionService`, detrás de una
 * concesión motivada y con fecha de fin. La línea es "sobre la relación" contra "sobre su
 * negocio", y está trazada por rutas distintas, no por un `if`.
 *
 * ## Selección explícita, siempre
 *
 * Nunca `findUnique` a secas. `settings` acumula configuración del cliente —su techo de gasto
 * en IA, su exigencia de fiabilidad— y el día que alguien guarde algo sensible ahí, un
 * `select` ausente lo estaría devolviendo sin que nadie lo hubiera decidido.
 *
 * ## Y toda acción se registra sin `organizationId`
 *
 * `AuditLog` cae en cascada con la organización. Una acción administrativa registrada con el
 * identificador de la empresa afectada desaparecería al borrar esa empresa — y es justo
 * entonces cuando hay que poder demostrar qué se le hizo. La empresa viaja en `metadata`.
 */
@Injectable()
export class PlatformOrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Los números del producto entero.
   *
   * Agregados de la plataforma, no de ninguna empresa: cuántos clientes hay y cómo se
   * reparten por plan. De aquí no se puede deducir nada sobre un cliente concreto.
   */
  async overview() {
    const [totalUsers, totalOrganizations, bannedUsers, byPlan] =
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
        byPlan.map((row) => [row.planTier, row._count]),
      ),
    };
  }

  /** La cartera de clientes, paginada. */
  async list(rawPage?: number) {
    const page = normalizePage(rawPage);
    const [items, total] = await Promise.all([
      this.prisma.organization.findMany({
        select: CATALOGUE_FIELDS,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.organization.count(),
    ]);

    return paginate(items, total, page);
  }

  /**
   * Una empresa del catálogo.
   *
   * Devuelve EXACTAMENTE lo mismo que su fila en el listado, ni un campo más. Que exista una
   * ruta para una sola empresa es comodidad de la interfaz —enlazar a una ficha sin recorrer
   * páginas— y no puede convertirse, por serlo, en una puerta que enseñe más que la lista.
   */
  async detail(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: CATALOGUE_FIELDS,
    });
    if (!organization) {
      throw new NotFoundException('Organización no encontrada');
    }

    return organization;
  }

  /**
   * Cambiar el plan de una empresa.
   *
   * Acción sensible: la ruta exige credencial reciente. Registra el valor anterior y el nuevo,
   * porque "se cambió el plan" sin decir de qué a qué no responde nada seis meses después.
   *
   * Un cambio al mismo plan se rechaza en vez de registrarse: una traza llena de entradas que
   * no cambiaron nada es ruido que hace más difícil encontrar las que sí.
   */
  async changePlan(params: {
    organizationId: string;
    planTier: PlanTier;
    actorId: string;
  }) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: params.organizationId },
      select: { id: true, name: true, planTier: true },
    });
    if (!organization) {
      throw new NotFoundException('Organización no encontrada');
    }

    if (organization.planTier === params.planTier) {
      return {
        id: organization.id,
        planTier: organization.planTier,
        changed: false,
      };
    }

    const updated = await this.prisma.organization.update({
      where: { id: params.organizationId },
      data: { planTier: params.planTier },
      select: { id: true, planTier: true },
    });

    await this.audit.record({
      // SIN `organizationId`: con él, esta entrada se borraría el día que se borre la empresa,
      // que es justo cuando hace falta poder demostrar qué se le hizo.
      organizationId: null,
      actorId: params.actorId,
      action: AUDIT_ACTIONS.ORGANIZATION_PLAN_CHANGED,
      targetType: AUDIT_TARGET_TYPES.ORGANIZATION,
      targetId: organization.id,
      metadata: {
        organizationId: organization.id,
        organizationName: organization.name,
        from: organization.planTier,
        to: params.planTier,
      },
    });

    return { id: updated.id, planTier: updated.planTier, changed: true };
  }
}

/**
 * Lo que se ve de una empresa en el catálogo. Un solo sitio, para las dos rutas.
 *
 * Escrito como constante y no repetido en cada consulta: dos listas de campos que tienen que
 * coincidir acaban separándose, y aquí separarse significa que una de las dos rutas empieza a
 * devolver algo que la otra decidió no devolver.
 */
const CATALOGUE_FIELDS = {
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
} as const;

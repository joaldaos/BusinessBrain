import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PLATFORM_AUDIT_ACTIONS } from '../audit/domain/platform-actions';

const PAGE_SIZE = 50;

/**
 * Qué ha hecho la administración de BusinessBrain.
 *
 * ## Lo que este listado NO es
 *
 * No es "la auditoría del sistema". Es la de la PLATAFORMA: qué ha hecho quien opera
 * BusinessBrain. La actividad de cada empresa —quién curó una conclusión, quién aceptó una
 * recomendación, quién conectó su Drive— **no aparece aquí y no debe aparecer**. Exponerla
 * convertiría este listado en la vía indirecta que el aislamiento entre plataforma y clientes
 * existe para cerrar: no haría falta leer los documentos de una empresa para saber de qué
 * habla su negocio, bastaría con leer lo que hace su gente.
 *
 * Por eso el filtro es una **lista cerrada de acciones** y no una condición. Ver
 * `audit/domain/platform-actions.ts` para los dos casos reales en los que una condición
 * habría fallado.
 *
 * ## Y por qué no devuelve la fila tal cual
 *
 * `AuditLog` es una tabla interna: nombres de columna, identificadores y un `metadata` de
 * forma libre. Entregarla en crudo obligaría a la interfaz a interpretarla —y a interpretarla
 * igual en cada pantalla— además de arrastrar campos que a nadie le sirven. Aquí se compone la
 * respuesta a las cinco preguntas que hay que poder responder: quién, qué, sobre qué empresa,
 * cuándo y con qué resultado.
 *
 * ## Sobre el "resultado"
 *
 * La auditoría registra HECHOS CONSUMADOS: si hay entrada, la acción ocurrió. No existen
 * entradas de intentos fallidos —eso son alertas y registro de aplicación— así que el
 * resultado de una acción es lo que dejó, y eso vive en `details`. Inventar una columna
 * `result` que siempre dijera "correcto" sería ruido con aspecto de información.
 */

export interface PlatformAuditEntry {
  id: string;
  at: string;
  /** Código estable. La interfaz lo traduce; nunca se enseña tal cual. */
  code: string;
  /** Quién. Nombre, no correo: identificar no exige exponer más de lo necesario. */
  actor: { id: string; name: string } | null;
  /** Sobre qué empresa. Se resuelve desde `metadata`, que es donde sobrevive al borrado. */
  organization: { id: string; name: string | null } | null;
  target: { type: string | null; id: string | null };
  /** Qué dejó la acción. Ya redactado en la escritura. */
  details: Record<string, unknown>;
}

export interface PlatformAuditQuery {
  page?: number;
  /** Filtrar por una acción concreta. Se valida contra la lista cerrada. */
  code?: string;
  /** Filtrar por la empresa afectada. */
  organizationId?: string;
}

/** Claves de `metadata` que NO se devuelven: identifican la empresa y ya viajan resueltas. */
const RESOLVED_INTO_ORGANIZATION = new Set([
  'organizationId',
  'organizationName',
]);

@Injectable()
export class PlatformAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PlatformAuditQuery) {
    const page =
      Number.isInteger(query.page) && (query.page as number) > 0
        ? (query.page as number)
        : 1;

    // Un código que no esté en la lista cerrada no estrecha la consulta: la vacía. Filtrar por
    // `insight.curated` no puede devolver nada, ni siquiera por accidente.
    const acciones =
      query.code !== undefined
        ? PLATFORM_AUDIT_ACTIONS.filter((accion) => accion === query.code)
        : PLATFORM_AUDIT_ACTIONS;

    const where = {
      action: { in: [...acciones] },
      // La empresa afectada vive en `metadata`, no en la columna: las acciones de plataforma
      // se escriben sin `organizationId` para sobrevivir al borrado del cliente.
      ...(query.organizationId
        ? {
            metadata: {
              path: ['organizationId'],
              equals: query.organizationId,
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          metadata: true,
          createdAt: true,
          // El nombre del actor, no su correo: para saber quién hizo algo basta con el
          // nombre, y el correo es dato personal que aquí no aporta nada.
          actor: { select: { id: true, name: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.present(row)),
      total,
      page,
      pages: Math.ceil(total / PAGE_SIZE),
    };
  }

  /** Las acciones que se pueden consultar. La interfaz las traduce para ofrecer el filtro. */
  catalog(): string[] {
    return [...PLATFORM_AUDIT_ACTIONS];
  }

  private present(row: {
    id: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    metadata: unknown;
    createdAt: Date;
    actor: { id: string; name: string } | null;
  }): PlatformAuditEntry {
    const metadata =
      typeof row.metadata === 'object' && row.metadata !== null
        ? (row.metadata as Record<string, unknown>)
        : {};

    const organizationId = metadata.organizationId;
    const organizationName = metadata.organizationName;

    return {
      id: row.id,
      at: row.createdAt.toISOString(),
      code: row.action,
      actor: row.actor,
      organization:
        typeof organizationId === 'string'
          ? {
              id: organizationId,
              // El nombre queda congelado en la traza a propósito: es el que tenía la empresa
              // cuando ocurrió, y sigue ahí aunque la empresa ya no exista.
              name:
                typeof organizationName === 'string' ? organizationName : null,
            }
          : null,
      target: { type: row.targetType, id: row.targetId },
      details: Object.fromEntries(
        Object.entries(metadata).filter(
          ([clave]) => !RESOLVED_INTO_ORGANIZATION.has(clave),
        ),
      ),
    };
  }
}

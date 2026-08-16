import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@businessbrain/database';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditAction, AuditTargetType } from './domain/audit-actions';
import {
  diffForAudit,
  hasChanges,
  redactAuditMetadata,
  type AuditChanges,
} from './domain/audit-redaction';

/**
 * Escritura de la traza de auditoría — subfase 6.2.
 *
 * **Único escritor de `AuditLog` del sistema.** Antes había tres sitios creando entradas por
 * su cuenta con vocabularios distintos y sin ninguna redacción; el día que alguien audite
 * "quién tocó los permisos de esta organización" necesita que todas las entradas sigan el
 * mismo contrato, no tres aproximaciones parecidas.
 *
 * ## Registrar NUNCA rompe la operación auditada
 *
 * Un fallo al escribir la traza no puede convertir en error una operación que ya ocurrió y
 * que fue correcta. La auditoría se escribe DESPUÉS del cambio y fuera de su transacción, así
 * que lanzar aquí no desharía nada: solo devolvería un error por algo que sí se hizo, y
 * empujaría a envolver cada llamada en un `try/catch` hasta que alguien lo olvidara.
 *
 * La contrapartida es explícita: un fallo de auditoría deja un hueco. Por eso se registra en
 * el log de aplicación con nivel de error, con toda la información necesaria para
 * reconstruirlo a mano. Preferimos un hueco visible a una operación rota.
 *
 * ## Qué NO hace
 *
 * No expone lectura. Un `GET /audit-logs` parece la continuación natural, pero las entradas
 * llevan metadatos de entidades acotadas por `effectiveCollectionScope` —una decisión sobre
 * una `Recommendation` incluye su alcance y su `sourceInsightId`—, así que exponerlas sin
 * decidir cómo interactúa la auditoría con el alcance por colección abriría una vía a
 * comprensión que el lector no puede ver. Esa decisión es de seguridad y no se improvisa
 * dentro de una subfase de instrumentación: queda registrada como pendiente.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra un hecho consumado.
   *
   * `organizationId` y `actorId` son opcionales en el esquema porque existen acciones de
   * plataforma sin organización (un baneo de super admin) y acciones sin persona detrás
   * (un disparo automático futuro). En una acción de organización deben venir siempre: sin
   * ellos la entrada no responde a "quién, en qué empresa", que es la mitad de la pregunta.
   */
  async record(params: {
    organizationId?: string | null;
    actorId?: string | null;
    action: AuditAction;
    targetType?: AuditTargetType;
    targetId?: string;
    /** Contexto del hecho. Pasa SIEMPRE por redacción antes de persistirse. */
    metadata?: Record<string, unknown>;
    /** Estado anterior y nuevo, cuando la acción modifica algo existente. */
    changes?: AuditChanges;
    ipAddress?: string;
  }): Promise<void> {
    try {
      const metadata = redactAuditMetadata({
        ...(params.metadata ?? {}),
        ...(params.changes
          ? { before: params.changes.before, after: params.changes.after }
          : {}),
      }) as Prisma.InputJsonValue;

      await this.prisma.auditLog.create({
        data: {
          organizationId: params.organizationId ?? null,
          actorId: params.actorId ?? null,
          action: params.action,
          targetType: params.targetType ?? null,
          targetId: params.targetId ?? null,
          metadata,
          ipAddress: params.ipAddress ?? null,
        },
      });
    } catch (error) {
      // Hueco visible antes que operación rota. Se vuelca lo suficiente para reconstruir la
      // entrada a mano si hiciera falta.
      this.logger.error(
        `No se pudo registrar la auditoría de "${params.action}" sobre ` +
          `${params.targetType ?? 'sin objetivo'}:${params.targetId ?? '-'} ` +
          `(organización ${params.organizationId ?? '-'}, actor ${params.actorId ?? '-'}): ` +
          `${(error as Error).message}`,
      );
    }
  }

  /**
   * Registra un cambio calculando la diferencia entre dos estados.
   *
   * Si nada cambió no se registra nada: una entrada de auditoría que dice que no pasó nada
   * solo sirve para diluir las que sí importan.
   */
  async recordChange(params: {
    organizationId: string;
    actorId: string;
    action: AuditAction;
    targetType: AuditTargetType;
    targetId: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const changes = diffForAudit(params.before, params.after);

    // Sin cambios no hay nada que registrar. Una entrada que dice que no pasó nada solo
    // sirve para diluir las que sí importan, y en una traza que se consulta en
    // investigaciones el ruido es el enemigo.
    if (!hasChanges(changes)) return;

    await this.record({
      organizationId: params.organizationId,
      actorId: params.actorId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata,
      changes,
    });
  }
}

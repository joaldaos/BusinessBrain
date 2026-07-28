import { Injectable } from '@nestjs/common';
import {
  CanonicalResolutionStatus,
  ConnectionStatus,
  KnowledgeItemStatus,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { getDecaySettings } from '../../knowledge-engine/domain/confidence-decay';
import { TERMINAL_KNOWLEDGE_ITEM_STATUSES } from '../../knowledge-engine/domain/knowledge-item-status.classification';
import type {
  KnowledgeSignal,
  KnowledgeSignalsPort,
  KnowledgeSignalsQuery,
} from '../domain/ports/knowledge-signals.port';

/**
 * Implementación de `KnowledgeSignalsPort` sobre el almacenamiento del Knowledge Engine.
 *
 * KNOWLEDGE_ENGINE_DESIGN.md §13.1 declara esta superficie como contrato consumible desde
 * la revisión formal de 2026-07-28. Entrega HECHOS objetivos —qué decayó, qué conflicto
 * sigue abierto, qué fuente está desconectada— y JAMÁS veredictos sobre lo que significan:
 * interpretar si un cambio invalida un razonamiento es epistemología, y pertenece en
 * exclusiva al Understanding Engine (UNDERSTANDING_ENGINE_DESIGN.md §3.4, §13).
 *
 * No accede a `KnowledgeChunk` ni al almacén vectorial: por eso no constituye una excepción
 * a la regla de que el Retriever es el único camino al contenido (KE §15).
 */
@Injectable()
export class PrismaKnowledgeSignalsAdapter implements KnowledgeSignalsPort {
  constructor(private readonly prisma: PrismaService) {}

  async listSignals(query: KnowledgeSignalsQuery): Promise<KnowledgeSignal[]> {
    const wanted = (kind: KnowledgeSignal['kind']) =>
      !query.kinds || query.kinds.includes(kind);

    const signals = await Promise.all([
      wanted('CONFIDENCE_DECAYED') ? this.confidenceDecayed(query) : [],
      wanted('CANONICALIZATION_UNRESOLVED')
        ? this.canonicalizationUnresolved(query)
        : [],
      wanted('SOURCE_DISCONNECTED') ? this.sourceDisconnected(query) : [],
    ]);

    return signals
      .flat()
      .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  }

  /**
   * Confianza por debajo del piso configurado (KE §8.3, §8.5). El umbral se lee de la
   * configuración de la organización, nunca de una constante: es el mismo valor que usa el
   * decaimiento, para que la señal y el mecanismo que la produce no puedan divergir.
   */
  private async confidenceDecayed(
    query: KnowledgeSignalsQuery,
  ): Promise<KnowledgeSignal[]> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: query.organizationId },
      select: { settings: true },
    });
    const floor = getDecaySettings(organization.settings).minimumFloor;

    const items = await this.prisma.knowledgeItem.findMany({
      where: {
        organizationId: query.organizationId,
        status: {
          notIn: TERMINAL_KNOWLEDGE_ITEM_STATUSES as KnowledgeItemStatus[],
        },
        confidenceScore: { lte: floor },
        ...(query.since ? { confidenceComputedAt: { gte: query.since } } : {}),
      },
      select: {
        id: true,
        title: true,
        confidenceScore: true,
        confidenceComputedAt: true,
        businessArea: true,
        currentKnowledgeSourceId: true,
        createdAt: true,
      },
    });

    return items.map((item) => ({
      kind: 'CONFIDENCE_DECAYED' as const,
      subjectKind: 'KNOWLEDGE_ITEM' as const,
      subjectId: item.id,
      observedAt: item.confidenceComputedAt ?? item.createdAt,
      facts: {
        title: item.title,
        confidenceScore: item.confidenceScore,
        floor,
        businessArea: item.businessArea,
        knowledgeSourceId: item.currentKnowledgeSourceId,
      },
    }));
  }

  /** Grupos canónicos que el sistema no pudo resolver y esperan revisión humana (KE §10). */
  private async canonicalizationUnresolved(
    query: KnowledgeSignalsQuery,
  ): Promise<KnowledgeSignal[]> {
    const entities = await this.prisma.canonicalKnowledgeEntity.findMany({
      where: {
        organizationId: query.organizationId,
        status: CanonicalResolutionStatus.IN_CONFLICT,
        ...(query.since ? { updatedAt: { gte: query.since } } : {}),
      },
      select: {
        id: true,
        winnerMargin: true,
        updatedAt: true,
        candidates: { select: { knowledgeItemId: true } },
      },
    });

    return entities.map((entity) => ({
      kind: 'CANONICALIZATION_UNRESOLVED' as const,
      subjectKind: 'CANONICAL_ENTITY' as const,
      subjectId: entity.id,
      observedAt: entity.updatedAt,
      facts: {
        candidateCount: entity.candidates.length,
        candidateIds: entity.candidates.map((c) => c.knowledgeItemId),
        winnerMargin: entity.winnerMargin,
      },
    }));
  }

  /** Fuentes en error o deshabilitadas (KE §3.2, §5): su conocimiento deja de actualizarse. */
  private async sourceDisconnected(
    query: KnowledgeSignalsQuery,
  ): Promise<KnowledgeSignal[]> {
    const sources = await this.prisma.knowledgeSource.findMany({
      where: {
        organizationId: query.organizationId,
        status: { in: [ConnectionStatus.ERROR, ConnectionStatus.DISABLED] },
        ...(query.since ? { updatedAt: { gte: query.since } } : {}),
      },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        lastError: true,
        lastSyncedAt: true,
        updatedAt: true,
        // Documentos que esta fuente mantiene HOY: son los que dejan de actualizarse.
        _count: { select: { knowledgeItemsAsCurrent: true } },
      },
    });

    return sources.map((source) => ({
      kind: 'SOURCE_DISCONNECTED' as const,
      subjectKind: 'KNOWLEDGE_SOURCE' as const,
      subjectId: source.id,
      observedAt: source.updatedAt,
      facts: {
        name: source.name,
        type: source.type,
        status: source.status,
        lastError: source.lastError,
        lastSyncedAt: source.lastSyncedAt,
        affectedKnowledgeItems: source._count.knowledgeItemsAsCurrent,
      },
    }));
  }
}

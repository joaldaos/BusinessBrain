import { KnowledgeItemStatus } from '@businessbrain/database';

/**
 * Clasificación de KnowledgeItemStatus en activo/terminal a efectos de deduplicación e
 * idempotencia bajo concurrencia (KNOWLEDGE_ENGINE_DESIGN.md §3.5, "Regla arquitectónica de
 * evolución del ciclo de vida" — Revisión formal, Subfase 2.2). Debe reflejar exactamente los
 * estados excluidos por el índice único parcial definido en la migración
 * `knowledge_engine_2_2_lineage_graph` (`KnowledgeItem_org_contentHash_active_key`).
 *
 * Todo valor nuevo añadido a KnowledgeItemStatus debe clasificarse aquí explícitamente — el test
 * de este archivo falla en CI si no lo está (fail-closed: un valor sin clasificar nunca se trata
 * implícitamente como terminal).
 */
export const TERMINAL_KNOWLEDGE_ITEM_STATUSES: readonly KnowledgeItemStatus[] =
  [
    KnowledgeItemStatus.SUPERSEDED,
    KnowledgeItemStatus.FAILED,
    KnowledgeItemStatus.DELETED,
  ];

export const ACTIVE_KNOWLEDGE_ITEM_STATUSES: readonly KnowledgeItemStatus[] = [
  KnowledgeItemStatus.PENDING,
  KnowledgeItemStatus.PROCESSING,
  KnowledgeItemStatus.INDEXED,
];

export function isTerminalKnowledgeItemStatus(
  status: KnowledgeItemStatus,
): boolean {
  return (TERMINAL_KNOWLEDGE_ITEM_STATUSES as KnowledgeItemStatus[]).includes(
    status,
  );
}

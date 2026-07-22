import { KnowledgeItemStatus } from '@businessbrain/database';
import {
  ACTIVE_KNOWLEDGE_ITEM_STATUSES,
  TERMINAL_KNOWLEDGE_ITEM_STATUSES,
} from './knowledge-item-status.classification';

/**
 * Impone en CI la regla arquitectónica de KNOWLEDGE_ENGINE_DESIGN.md §3.5: todo valor de
 * KnowledgeItemStatus debe clasificarse explícitamente como activo o terminal. Si alguien añade
 * un valor nuevo al enum de Prisma sin pasar por esa clasificación, este test falla — es
 * deliberado, no un descuido: la ausencia de clasificación nunca debe resolverse por omisión.
 */
describe('Clasificación de KnowledgeItemStatus (activo/terminal)', () => {
  const allStatuses = Object.values(KnowledgeItemStatus);

  it('todo valor del enum está clasificado en exactamente una de las dos listas', () => {
    const classified = new Set([
      ...ACTIVE_KNOWLEDGE_ITEM_STATUSES,
      ...TERMINAL_KNOWLEDGE_ITEM_STATUSES,
    ]);

    const unclassified = allStatuses.filter(
      (status) => !classified.has(status),
    );
    expect(unclassified).toEqual([]);
    expect(classified.size).toBe(allStatuses.length);
  });

  it('ninguna lista se solapa con la otra', () => {
    const overlap = ACTIVE_KNOWLEDGE_ITEM_STATUSES.filter((status) =>
      (TERMINAL_KNOWLEDGE_ITEM_STATUSES as KnowledgeItemStatus[]).includes(
        status,
      ),
    );
    expect(overlap).toEqual([]);
  });

  it('coincide exactamente con los estados terminales usados por el índice único parcial de idempotencia', () => {
    // Debe reflejar la migración knowledge_engine_2_2_lineage_graph
    // (KnowledgeItem_org_contentHash_active_key: WHERE status NOT IN (...)).
    expect([...TERMINAL_KNOWLEDGE_ITEM_STATUSES].sort()).toEqual(
      ['DELETED', 'FAILED', 'SUPERSEDED'].sort(),
    );
  });
});

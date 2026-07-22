import { PrismaClient } from '@businessbrain/database';
import { computeContentHash } from '../src/knowledge-engine/domain/content-canonicalization';

const prisma = new PrismaClient();

/**
 * Migracion de datos (no de esquema) exigida por el contrato de contenido canonico
 * (KNOWLEDGE_ENGINE_DESIGN.md S3.12): todo KnowledgeItem ingerido antes de que existiera
 * `canonicalizeContent`/`computeContentHash` tiene un `contentHash` calculado sobre el texto
 * crudo, no sobre el contenido canonico - deja de ser comparable con los hashes que produce el
 * codigo actual. Este script recalcula `contentHash` para TODOS los KnowledgeItem existentes
 * (cualquier estado, no solo los activos: la consistencia del hash es un invariante del dato,
 * no solo de los items en uso), sin tocar ningun otro campo. Idempotente: recalcular dos veces
 * el mismo item produce el mismo resultado.
 *
 * No resuelve automaticamente colisiones que el recalculo pueda revelar (dos KnowledgeItem
 * activos que antes tenian hashes distintos y ahora coinciden) - eso es una decision de
 * contenido, no una operacion tecnica; el script las detecta y las deja registradas para
 * revision humana, nunca las fusiona ni elimina nada por su cuenta.
 */
async function main() {
  const items = await prisma.knowledgeItem.findMany({
    select: { id: true, organizationId: true, contentText: true, contentHash: true, status: true },
  });

  let updated = 0;
  let unchanged = 0;
  const potentialCollisions: { organizationId: string; contentHash: string; knowledgeItemIds: string[] }[] = [];

  const recomputedByOrgAndHash = new Map<string, string[]>();

  for (const item of items) {
    const recomputedHash = computeContentHash(item.contentText);

    const activeKey = `${item.organizationId}:${recomputedHash}`;
    if (!['SUPERSEDED', 'FAILED', 'DELETED'].includes(item.status)) {
      const existing = recomputedByOrgAndHash.get(activeKey) ?? [];
      existing.push(item.id);
      recomputedByOrgAndHash.set(activeKey, existing);
    }

    if (recomputedHash === item.contentHash) {
      unchanged += 1;
      continue;
    }

    await prisma.knowledgeItem.update({
      where: { id: item.id },
      data: { contentHash: recomputedHash },
    });
    updated += 1;
  }

  for (const [key, ids] of recomputedByOrgAndHash) {
    if (ids.length > 1) {
      const [organizationId, contentHash] = key.split(':');
      potentialCollisions.push({ organizationId, contentHash, knowledgeItemIds: ids });
    }
  }

  console.log(`Recalculo de contentHash: ${updated} actualizados, ${unchanged} sin cambios (de ${items.length} totales).`);
  if (potentialCollisions.length > 0) {
    console.warn(
      `ATENCION: ${potentialCollisions.length} colision(es) de contentHash entre KnowledgeItem activos tras canonicalizar. ` +
        'Requieren revision humana, no se han fusionado automaticamente:',
    );
    console.warn(JSON.stringify(potentialCollisions, null, 2));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

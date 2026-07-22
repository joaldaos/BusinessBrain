/*
  Warnings:

  - You are about to drop the column `knowledgeCollectionId` on the `KnowledgeItem` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "KnowledgeItem" DROP CONSTRAINT "KnowledgeItem_knowledgeCollectionId_fkey";

-- NOTA (revisión manual antes de aplicar, subfase 2.2): igual que en la migración de la subfase
-- 2.1, Prisma generó aquí un "DROP INDEX KnowledgeChunk_embedding_hnsw_idx" que no corresponde a
-- ningún cambio de esta migración (KnowledgeChunk no se toca). Se elimina esa línea de forma
-- deliberada por el mismo motivo ya documentado allí: el motor de diff de Prisma no reconoce
-- índices sobre columnas "Unsupported(vector(N))" como gestionados y los marca para eliminar en
-- cualquier migración posterior.

-- DropIndex
DROP INDEX "KnowledgeItem_knowledgeCollectionId_idx";

-- AlterTable
ALTER TABLE "KnowledgeItem" DROP COLUMN "knowledgeCollectionId";

-- CreateTable
CREATE TABLE "KnowledgeItemCollection" (
    "id" TEXT NOT NULL,
    "knowledgeItemId" TEXT NOT NULL,
    "knowledgeCollectionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeItemCollection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeItemCollection_knowledgeCollectionId_idx" ON "KnowledgeItemCollection"("knowledgeCollectionId");

-- CreateIndex
CREATE INDEX "KnowledgeItemCollection_organizationId_idx" ON "KnowledgeItemCollection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeItemCollection_knowledgeItemId_knowledgeCollection_key" ON "KnowledgeItemCollection"("knowledgeItemId", "knowledgeCollectionId");

-- AddForeignKey
ALTER TABLE "KnowledgeItemCollection" ADD CONSTRAINT "KnowledgeItemCollection_knowledgeItemId_fkey" FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItemCollection" ADD CONSTRAINT "KnowledgeItemCollection_knowledgeCollectionId_fkey" FOREIGN KEY ("knowledgeCollectionId") REFERENCES "KnowledgeCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

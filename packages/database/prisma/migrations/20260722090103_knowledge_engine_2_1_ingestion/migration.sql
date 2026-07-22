/*
  Warnings:

  - You are about to drop the column `classification` on the `KnowledgeItem` table. All the data in the column will be lost.
  - You are about to drop the column `confidenceScore` on the `KnowledgeItem` table. All the data in the column will be lost.
  - You are about to drop the column `isCanonical` on the `KnowledgeItem` table. All the data in the column will be lost.
  - You are about to drop the column `knowledgeSourceId` on the `KnowledgeItem` table. All the data in the column will be lost.
  - You are about to drop the column `supersedesId` on the `KnowledgeItem` table. All the data in the column will be lost.
  - You are about to drop the column `version` on the `KnowledgeItem` table. All the data in the column will be lost.
  - Added the required column `contentText` to the `KnowledgeItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "KnowledgeItemStatus" ADD VALUE 'DELETED';

-- DropForeignKey
ALTER TABLE "KnowledgeItem" DROP CONSTRAINT "KnowledgeItem_knowledgeSourceId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgeItem" DROP CONSTRAINT "KnowledgeItem_supersedesId_fkey";

-- NOTA (revisión manual antes de aplicar, subfase 2.1): Prisma generó aquí un
-- "DROP INDEX KnowledgeChunk_embedding_hnsw_idx" que NO corresponde a ningún cambio de esta
-- migración. Ocurre porque ese índice HNSW se creó a mano en la migración inicial (los tipos
-- "Unsupported(vector(N))" no se declaran vía @@index en schema.prisma), así que el motor de
-- diff de Prisma no lo reconoce como gestionado y lo marca para eliminar en cualquier migración
-- posterior. Se elimina esa línea deliberadamente — nada en KnowledgeChunk cambia en esta
-- subfase y borrar el índice de recuperación semántica sería una regresión no relacionada.

-- DropIndex
DROP INDEX "KnowledgeItem_knowledgeSourceId_idx";

-- DropIndex
DROP INDEX "KnowledgeItem_supersedesId_key";

-- AlterTable
ALTER TABLE "KnowledgeItem" DROP COLUMN "classification",
DROP COLUMN "confidenceScore",
DROP COLUMN "isCanonical",
DROP COLUMN "knowledgeSourceId",
DROP COLUMN "supersedesId",
DROP COLUMN "version",
ADD COLUMN     "contentText" TEXT NOT NULL,
ADD COLUMN     "currentKnowledgeSourceId" TEXT,
ADD COLUMN     "originIngestionJobId" TEXT,
ADD COLUMN     "originKnowledgeSourceId" TEXT;

-- CreateIndex
CREATE INDEX "KnowledgeItem_originKnowledgeSourceId_idx" ON "KnowledgeItem"("originKnowledgeSourceId");

-- CreateIndex
CREATE INDEX "KnowledgeItem_currentKnowledgeSourceId_idx" ON "KnowledgeItem"("currentKnowledgeSourceId");

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_originKnowledgeSourceId_fkey" FOREIGN KEY ("originKnowledgeSourceId") REFERENCES "KnowledgeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_originIngestionJobId_fkey" FOREIGN KEY ("originIngestionJobId") REFERENCES "IngestionJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_currentKnowledgeSourceId_fkey" FOREIGN KEY ("currentKnowledgeSourceId") REFERENCES "KnowledgeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

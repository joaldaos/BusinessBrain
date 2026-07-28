-- AlterTable
ALTER TABLE "KnowledgeChunk" ADD COLUMN     "contentHash" TEXT NOT NULL,
ADD COLUMN     "embeddingModel" TEXT NOT NULL,
ADD COLUMN     "embeddingVersion" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "KnowledgeChunk_organizationId_contentHash_embeddingModel_idx" ON "KnowledgeChunk"("organizationId", "contentHash", "embeddingModel");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_knowledgeItemId_chunkIndex_key" ON "KnowledgeChunk"("knowledgeItemId", "chunkIndex");


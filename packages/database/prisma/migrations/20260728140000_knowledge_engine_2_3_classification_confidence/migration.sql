-- CreateEnum
CREATE TYPE "ClassificationSource" AS ENUM ('AUTOMATIC', 'MANUAL');

-- AlterTable
ALTER TABLE "KnowledgeItem" ADD COLUMN     "businessArea" "AgentArea",
ADD COLUMN     "classificationCertainty" DOUBLE PRECISION,
ADD COLUMN     "classificationSource" "ClassificationSource",
ADD COLUMN     "classifiedAt" TIMESTAMP(3),
ADD COLUMN     "confidenceComputedAt" TIMESTAMP(3),
ADD COLUMN     "confidenceFactors" JSONB,
ADD COLUMN     "confidenceScore" DOUBLE PRECISION,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "taxonomyNodeId" TEXT;

-- CreateTable
CREATE TABLE "TaxonomyNode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentId" TEXT,
    "businessArea" "AgentArea" NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxonomyNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxonomyNode_organizationId_idx" ON "TaxonomyNode"("organizationId");

-- CreateIndex
CREATE INDEX "TaxonomyNode_parentId_idx" ON "TaxonomyNode"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyNode_organizationId_key_key" ON "TaxonomyNode"("organizationId", "key");

-- CreateIndex
CREATE INDEX "KnowledgeItem_taxonomyNodeId_idx" ON "KnowledgeItem"("taxonomyNodeId");

-- CreateIndex
CREATE INDEX "KnowledgeItem_organizationId_businessArea_idx" ON "KnowledgeItem"("organizationId", "businessArea");

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_taxonomyNodeId_fkey" FOREIGN KEY ("taxonomyNodeId") REFERENCES "TaxonomyNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxonomyNode" ADD CONSTRAINT "TaxonomyNode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxonomyNode" ADD CONSTRAINT "TaxonomyNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TaxonomyNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


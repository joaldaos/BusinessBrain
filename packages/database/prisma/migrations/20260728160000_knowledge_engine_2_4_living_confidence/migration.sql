-- CreateEnum
CREATE TYPE "ConfidenceEventType" AS ENUM ('INITIAL', 'TEMPORAL_DECAY', 'SOURCE_DISCONNECTED', 'MANUAL_OVERRIDE', 'MANUAL_REVOKED');

-- AlterTable
ALTER TABLE "KnowledgeItem" ADD COLUMN     "confidenceIsManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "confidenceManualAt" TIMESTAMP(3),
ADD COLUMN     "confidenceManualById" TEXT;

-- CreateTable
CREATE TABLE "ConfidenceEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "knowledgeItemId" TEXT NOT NULL,
    "type" "ConfidenceEventType" NOT NULL,
    "previousScore" DOUBLE PRECISION,
    "newScore" DOUBLE PRECISION NOT NULL,
    "detail" JSONB NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfidenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConfidenceEvent_knowledgeItemId_createdAt_idx" ON "ConfidenceEvent"("knowledgeItemId", "createdAt");

-- CreateIndex
CREATE INDEX "ConfidenceEvent_organizationId_idx" ON "ConfidenceEvent"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeItem_organizationId_confidenceComputedAt_idx" ON "KnowledgeItem"("organizationId", "confidenceComputedAt");

-- AddForeignKey
ALTER TABLE "ConfidenceEvent" ADD CONSTRAINT "ConfidenceEvent_knowledgeItemId_fkey" FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;


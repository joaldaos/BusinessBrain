-- CreateEnum
CREATE TYPE "InsightFeedbackType" AS ENUM ('CONFIRMATION', 'DISMISSAL', 'CORRECTION', 'REVOCATION');

-- AlterTable
ALTER TABLE "Insight" ADD COLUMN     "confidenceComputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN     "advantages" TEXT,
ADD COLUMN     "affectedAreas" TEXT,
ADD COLUMN     "detected" TEXT,
ADD COLUMN     "drawbacks" TEXT,
ADD COLUMN     "effectiveCollectionScope" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "estimatedImpact" TEXT,
ADD COLUMN     "justification" TEXT,
ADD COLUMN     "migrationPlan" TEXT,
ADD COLUMN     "sourceInsightId" TEXT;

-- CreateTable
CREATE TABLE "InsightFeedback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "type" "InsightFeedbackType" NOT NULL,
    "comment" TEXT,
    "revokesFeedbackId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InsightFeedback_revokesFeedbackId_key" ON "InsightFeedback"("revokesFeedbackId");

-- CreateIndex
CREATE INDEX "InsightFeedback_insightId_createdAt_idx" ON "InsightFeedback"("insightId", "createdAt");

-- CreateIndex
CREATE INDEX "InsightFeedback_organizationId_idx" ON "InsightFeedback"("organizationId");

-- CreateIndex
CREATE INDEX "Recommendation_sourceInsightId_idx" ON "Recommendation"("sourceInsightId");

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_sourceInsightId_fkey" FOREIGN KEY ("sourceInsightId") REFERENCES "Insight"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightFeedback" ADD CONSTRAINT "InsightFeedback_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "Insight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightFeedback" ADD CONSTRAINT "InsightFeedback_revokesFeedbackId_fkey" FOREIGN KEY ("revokesFeedbackId") REFERENCES "InsightFeedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;


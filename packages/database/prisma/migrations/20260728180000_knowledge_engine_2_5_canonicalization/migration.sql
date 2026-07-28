-- CreateEnum
CREATE TYPE "CanonicalResolutionStatus" AS ENUM ('RESOLVED', 'IN_CONFLICT');

-- CreateEnum
CREATE TYPE "CanonicalCandidateOrigin" AS ENUM ('SEMANTIC_DEDUPLICATION', 'MANUAL_LINK');

-- CreateTable
CREATE TABLE "CanonicalKnowledgeEntity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "CanonicalResolutionStatus" NOT NULL DEFAULT 'IN_CONFLICT',
    "winnerKnowledgeItemId" TEXT,
    "winnerMargin" DOUBLE PRECISION,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalKnowledgeEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalCandidate" (
    "id" TEXT NOT NULL,
    "canonicalKnowledgeEntityId" TEXT NOT NULL,
    "knowledgeItemId" TEXT NOT NULL,
    "origin" "CanonicalCandidateOrigin" NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanonicalCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalDecision" (
    "id" TEXT NOT NULL,
    "canonicalKnowledgeEntityId" TEXT NOT NULL,
    "previousWinnerId" TEXT,
    "newWinnerId" TEXT,
    "status" "CanonicalResolutionStatus" NOT NULL,
    "rationale" JSONB NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanonicalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CanonicalKnowledgeEntity_organizationId_idx" ON "CanonicalKnowledgeEntity"("organizationId");

-- CreateIndex
CREATE INDEX "CanonicalKnowledgeEntity_organizationId_status_idx" ON "CanonicalKnowledgeEntity"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CanonicalCandidate_knowledgeItemId_idx" ON "CanonicalCandidate"("knowledgeItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalCandidate_canonicalKnowledgeEntityId_knowledgeItem_key" ON "CanonicalCandidate"("canonicalKnowledgeEntityId", "knowledgeItemId");

-- CreateIndex
CREATE INDEX "CanonicalDecision_canonicalKnowledgeEntityId_createdAt_idx" ON "CanonicalDecision"("canonicalKnowledgeEntityId", "createdAt");

-- AddForeignKey
ALTER TABLE "CanonicalKnowledgeEntity" ADD CONSTRAINT "CanonicalKnowledgeEntity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalKnowledgeEntity" ADD CONSTRAINT "CanonicalKnowledgeEntity_winnerKnowledgeItemId_fkey" FOREIGN KEY ("winnerKnowledgeItemId") REFERENCES "KnowledgeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalCandidate" ADD CONSTRAINT "CanonicalCandidate_canonicalKnowledgeEntityId_fkey" FOREIGN KEY ("canonicalKnowledgeEntityId") REFERENCES "CanonicalKnowledgeEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalCandidate" ADD CONSTRAINT "CanonicalCandidate_knowledgeItemId_fkey" FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalDecision" ADD CONSTRAINT "CanonicalDecision_canonicalKnowledgeEntityId_fkey" FOREIGN KEY ("canonicalKnowledgeEntityId") REFERENCES "CanonicalKnowledgeEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;


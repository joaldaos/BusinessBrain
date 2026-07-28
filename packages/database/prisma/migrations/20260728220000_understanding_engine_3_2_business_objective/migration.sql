-- CreateEnum
CREATE TYPE "BusinessObjectiveStatus" AS ENUM ('INFERRED', 'CONFIRMED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "BusinessObjectiveOrigin" AS ENUM ('MANUAL_DECLARATION', 'AUTOMATIC_INFERENCE');

-- CreateTable
CREATE TABLE "BusinessObjective" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "description" TEXT,
    "status" "BusinessObjectiveStatus" NOT NULL DEFAULT 'INFERRED',
    "origin" "BusinessObjectiveOrigin" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "supersedesObjectiveId" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightObjectiveLink" (
    "id" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "businessObjectiveId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightObjectiveLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessObjective_supersedesObjectiveId_key" ON "BusinessObjective"("supersedesObjectiveId");

-- CreateIndex
CREATE INDEX "BusinessObjective_organizationId_idx" ON "BusinessObjective"("organizationId");

-- CreateIndex
CREATE INDEX "BusinessObjective_organizationId_status_idx" ON "BusinessObjective"("organizationId", "status");

-- CreateIndex
CREATE INDEX "InsightObjectiveLink_businessObjectiveId_idx" ON "InsightObjectiveLink"("businessObjectiveId");

-- CreateIndex
CREATE UNIQUE INDEX "InsightObjectiveLink_insightId_businessObjectiveId_key" ON "InsightObjectiveLink"("insightId", "businessObjectiveId");

-- AddForeignKey
ALTER TABLE "BusinessObjective" ADD CONSTRAINT "BusinessObjective_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessObjective" ADD CONSTRAINT "BusinessObjective_supersedesObjectiveId_fkey" FOREIGN KEY ("supersedesObjectiveId") REFERENCES "BusinessObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightObjectiveLink" ADD CONSTRAINT "InsightObjectiveLink_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "Insight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightObjectiveLink" ADD CONSTRAINT "InsightObjectiveLink_businessObjectiveId_fkey" FOREIGN KEY ("businessObjectiveId") REFERENCES "BusinessObjective"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


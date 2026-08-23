-- DropForeignKey
ALTER TABLE "KnowledgeSource" DROP CONSTRAINT "KnowledgeSource_integration_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgeSourceCollection" DROP CONSTRAINT "KnowledgeSourceCollection_collection_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgeSourceCollection" DROP CONSTRAINT "KnowledgeSourceCollection_source_fkey";

-- DropIndex
DROP INDEX "KnowledgeItem_sourceMissing_idx";

-- DropIndex
DROP INDEX "KnowledgeSource_integrationId_idx";

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_integrationId_organizationId_fkey" FOREIGN KEY ("integrationId", "organizationId") REFERENCES "Integration"("id", "organizationId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSourceCollection" ADD CONSTRAINT "KnowledgeSourceCollection_knowledgeSourceId_organizationId_fkey" FOREIGN KEY ("knowledgeSourceId", "organizationId") REFERENCES "KnowledgeSource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSourceCollection" ADD CONSTRAINT "KnowledgeSourceCollection_knowledgeCollectionId_organizati_fkey" FOREIGN KEY ("knowledgeCollectionId", "organizationId") REFERENCES "KnowledgeCollection"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

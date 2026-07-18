-- Bootstrap: pgvector debe existir antes de que cualquier tabla declare una columna "vector(N)"
-- (KnowledgeChunk.embedding, más abajo). Sin esto, la migración falla.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'SUPERADMIN');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'TRIALING');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('FILE_UPLOAD', 'WEBSITE', 'GOOGLE_DRIVE', 'GMAIL', 'CRM', 'ERP', 'DATABASE', 'SOCIAL_MEDIA', 'API');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING', 'SYNCING', 'CONNECTED', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "IngestionTriggerType" AS ENUM ('MANUAL', 'SCHEDULE', 'EVENT');

-- CreateEnum
CREATE TYPE "KnowledgeItemStatus" AS ENUM ('PENDING', 'PROCESSING', 'INDEXED', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "LlmProviderName" AS ENUM ('ANTHROPIC', 'OPENAI', 'GEMINI', 'MISTRAL', 'OLLAMA');

-- CreateEnum
CREATE TYPE "AgentTemplateVisibility" AS ENUM ('PRIVATE', 'ORGANIZATION', 'PUBLIC');

-- CreateEnum
CREATE TYPE "AgentArea" AS ENUM ('SALES', 'MARKETING', 'SUPPORT', 'OPERATIONS', 'FINANCE', 'HR', 'GENERAL');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "AutomationTriggerType" AS ENUM ('SCHEDULE', 'EVENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('PDF', 'HTML', 'MARKDOWN', 'JSON');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('NEW', 'ACCEPTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('HUBSPOT', 'SALESFORCE', 'GOOGLE_DRIVE', 'SLACK', 'SAP', 'ZENDESK', 'CUSTOM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "planTier" "PlanTier" NOT NULL DEFAULT 'FREE',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'MEMBER',
    "invitedById" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'MEMBER',
    "token" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planTier" "PlanTier" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "paymentProviderCustomerId" TEXT,
    "paymentProviderSubscriptionId" TEXT,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "KnowledgeSourceType" NOT NULL,
    "connectorKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "configEnc" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionJob" (
    "id" TEXT NOT NULL,
    "knowledgeSourceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "triggerType" "IngestionTriggerType" NOT NULL DEFAULT 'MANUAL',
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeCollection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "area" "AgentArea",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "knowledgeSourceId" TEXT,
    "knowledgeCollectionId" TEXT,
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "contentHash" TEXT NOT NULL,
    "status" "KnowledgeItemStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "classification" JSONB,
    "confidenceScore" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCanonical" BOOLEAN NOT NULL DEFAULT true,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "indexedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "knowledgeItemId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT,
    "title" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "tokenCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT,
    "name" TEXT NOT NULL,
    "area" "AgentArea" NOT NULL DEFAULT 'GENERAL',
    "systemPrompt" TEXT NOT NULL,
    "llmProfileId" TEXT,
    "temperature" DOUBLE PRECISION,
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "tools" JSONB NOT NULL DEFAULT '[]',
    "memoryConfig" JSONB NOT NULL DEFAULT '{}',
    "guardrails" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTemplate" (
    "id" TEXT NOT NULL,
    "publisherOrgId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "area" "AgentArea" NOT NULL,
    "visibility" "AgentTemplateVisibility" NOT NULL DEFAULT 'PRIVATE',
    "defaultSystemPrompt" TEXT NOT NULL,
    "defaultCapabilities" JSONB NOT NULL DEFAULT '[]',
    "defaultTools" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "provider" "LlmProviderName" NOT NULL,
    "modelName" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "apiKeyEnc" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT,
    "area" "AgentArea",
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" "AutomationTriggerType" NOT NULL,
    "triggerConfig" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastRunAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "logs" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" "ReportFormat" NOT NULL DEFAULT 'PDF',
    "template" JSONB NOT NULL,
    "schedule" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "fileUrl" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "scope" TEXT,
    "expiresAt" TIMESTAMP(3),
    "connectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "type" "NotificationType" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AgentKnowledgeScope" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_slug_idx" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_idx" ON "Invitation"("organizationId");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeSource_organizationId_idx" ON "KnowledgeSource"("organizationId");

-- CreateIndex
CREATE INDEX "IngestionJob_knowledgeSourceId_idx" ON "IngestionJob"("knowledgeSourceId");

-- CreateIndex
CREATE INDEX "IngestionJob_organizationId_idx" ON "IngestionJob"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeCollection_organizationId_idx" ON "KnowledgeCollection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeItem_supersedesId_key" ON "KnowledgeItem"("supersedesId");

-- CreateIndex
CREATE INDEX "KnowledgeItem_organizationId_idx" ON "KnowledgeItem"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeItem_knowledgeSourceId_idx" ON "KnowledgeItem"("knowledgeSourceId");

-- CreateIndex
CREATE INDEX "KnowledgeItem_knowledgeCollectionId_idx" ON "KnowledgeItem"("knowledgeCollectionId");

-- CreateIndex
CREATE INDEX "KnowledgeItem_organizationId_contentHash_idx" ON "KnowledgeItem"("organizationId", "contentHash");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_organizationId_idx" ON "KnowledgeChunk"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_knowledgeItemId_idx" ON "KnowledgeChunk"("knowledgeItemId");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_idx" ON "Conversation"("organizationId");

-- CreateIndex
CREATE INDEX "Conversation_userId_idx" ON "Conversation"("userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Agent_organizationId_idx" ON "Agent"("organizationId");

-- CreateIndex
CREATE INDEX "AgentMemory_agentId_organizationId_idx" ON "AgentMemory"("agentId", "organizationId");

-- CreateIndex
CREATE INDEX "AgentTemplate_publisherOrgId_idx" ON "AgentTemplate"("publisherOrgId");

-- CreateIndex
CREATE INDEX "AgentTemplate_visibility_idx" ON "AgentTemplate"("visibility");

-- CreateIndex
CREATE INDEX "LlmProfile_organizationId_idx" ON "LlmProfile"("organizationId");

-- CreateIndex
CREATE INDEX "Recommendation_organizationId_idx" ON "Recommendation"("organizationId");

-- CreateIndex
CREATE INDEX "Automation_organizationId_idx" ON "Automation"("organizationId");

-- CreateIndex
CREATE INDEX "AutomationRun_automationId_idx" ON "AutomationRun"("automationId");

-- CreateIndex
CREATE INDEX "Report_organizationId_idx" ON "Report"("organizationId");

-- CreateIndex
CREATE INDEX "ReportRun_reportId_idx" ON "ReportRun"("reportId");

-- CreateIndex
CREATE INDEX "Integration_organizationId_idx" ON "Integration"("organizationId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_organizationId_idx" ON "Notification"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_idx" ON "ApiKey"("organizationId");

-- CreateIndex
CREATE INDEX "UsageRecord_organizationId_metric_periodStart_idx" ON "UsageRecord"("organizationId", "metric", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "_AgentKnowledgeScope_AB_unique" ON "_AgentKnowledgeScope"("A", "B");

-- CreateIndex
CREATE INDEX "_AgentKnowledgeScope_B_index" ON "_AgentKnowledgeScope"("B");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_knowledgeSourceId_fkey" FOREIGN KEY ("knowledgeSourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCollection" ADD CONSTRAINT "KnowledgeCollection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_knowledgeSourceId_fkey" FOREIGN KEY ("knowledgeSourceId") REFERENCES "KnowledgeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_knowledgeCollectionId_fkey" FOREIGN KEY ("knowledgeCollectionId") REFERENCES "KnowledgeCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "KnowledgeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_knowledgeItemId_fkey" FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AgentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_llmProfileId_fkey" FOREIGN KEY ("llmProfileId") REFERENCES "LlmProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTemplate" ADD CONSTRAINT "AgentTemplate_publisherOrgId_fkey" FOREIGN KEY ("publisherOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmProfile" ADD CONSTRAINT "LlmProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentKnowledgeScope" ADD CONSTRAINT "_AgentKnowledgeScope_A_fkey" FOREIGN KEY ("A") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentKnowledgeScope" ADD CONSTRAINT "_AgentKnowledgeScope_B_fkey" FOREIGN KEY ("B") REFERENCES "KnowledgeCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Índice HNSW para búsqueda semántica por similitud coseno (retrieve-context.use-case).
-- No expresable en schema.prisma (pgvector no es un tipo nativo de Prisma) — se añade a mano.
CREATE INDEX "KnowledgeChunk_embedding_hnsw_idx" ON "KnowledgeChunk" USING hnsw (embedding vector_cosine_ops);

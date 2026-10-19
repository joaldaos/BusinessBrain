-- Conectores por organización y su histórico de sincronización — Fase 9A.
-- Ver FASE-9A-9B-ARQUITECTURA-CERRADA.md §4.2.

-- CreateEnum
CREATE TYPE "ConnectorAuthKind" AS ENUM ('OAUTH2', 'API_KEY', 'BASIC', 'NONE');

-- CreateTable
CREATE TABLE "OrganizationConnector" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectorKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "integrationId" TEXT,
    "syncCursor" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationConnector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorSync" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "trigger" "IngestionTriggerType" NOT NULL DEFAULT 'MANUAL',
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ConnectorSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationConnector_organizationId_idx" ON "OrganizationConnector"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationConnector_organizationId_connectorKey_key" ON "OrganizationConnector"("organizationId", "connectorKey");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationConnector_id_organizationId_key" ON "OrganizationConnector"("id", "organizationId");

-- CreateIndex
CREATE INDEX "ConnectorSync_connectorId_startedAt_idx" ON "ConnectorSync"("connectorId", "startedAt");

-- CreateIndex
CREATE INDEX "ConnectorSync_organizationId_idx" ON "ConnectorSync"("organizationId");

-- AddForeignKey
ALTER TABLE "OrganizationConnector" ADD CONSTRAINT "OrganizationConnector_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationConnector" ADD CONSTRAINT "OrganizationConnector_integrationId_organizationId_fkey" FOREIGN KEY ("integrationId", "organizationId") REFERENCES "Integration"("id", "organizationId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorSync" ADD CONSTRAINT "ConnectorSync_connectorId_organizationId_fkey" FOREIGN KEY ("connectorId", "organizationId") REFERENCES "OrganizationConnector"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


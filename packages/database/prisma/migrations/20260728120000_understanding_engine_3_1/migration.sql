-- CreateEnum
CREATE TYPE "AnalysisRunTrigger" AS ENUM ('PERIODIC_SWEEP', 'KNOWLEDGE_SIGNAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "AnalysisRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "InsightType" AS ENUM ('PATTERN', 'ANOMALY', 'RISK', 'OPPORTUNITY');

-- CreateEnum
CREATE TYPE "InsightStatus" AS ENUM ('CANDIDATE', 'ACTIVE', 'SUPERSEDED', 'DISCARDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InsightEvidenceRole" AS ENUM ('BASELINE', 'DEVIATION', 'CORROBORATION', 'CONTRADICTION');

-- CreateEnum
CREATE TYPE "InsightEvidenceKind" AS ENUM ('KNOWLEDGE_ITEM', 'KNOWLEDGE_CHUNK', 'CANONICAL_ENTITY', 'DERIVED_INSIGHT');

-- DropIndex
DROP INDEX "KnowledgeChunk_embedding_hnsw_idx";

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "trigger" "AnalysisRunTrigger" NOT NULL,
    "status" "AnalysisRunStatus" NOT NULL DEFAULT 'PENDING',
    "candidatesGenerated" INTEGER NOT NULL DEFAULT 0,
    "insightsCreated" INTEGER NOT NULL DEFAULT 0,
    "insightsSuperseded" INTEGER NOT NULL DEFAULT 0,
    "insightsQueued" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insight" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "subjectIdentity" TEXT NOT NULL,
    "type" "InsightType" NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "InsightStatus" NOT NULL DEFAULT 'CANDIDATE',
    "strategyKey" TEXT NOT NULL,
    "strategyVersion" TEXT NOT NULL,
    "reasoningTrace" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "transitiveEvidenceClosure" JSONB NOT NULL,
    "supersedesInsightId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Insight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightEvidence" (
    "id" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "kind" "InsightEvidenceKind" NOT NULL,
    "role" "InsightEvidenceRole" NOT NULL,
    "knowledgeItemId" TEXT,
    "knowledgeChunkId" TEXT,
    "derivedInsightId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalysisRun_organizationId_idx" ON "AnalysisRun"("organizationId");

-- CreateIndex
CREATE INDEX "AnalysisRun_organizationId_status_idx" ON "AnalysisRun"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Insight_supersedesInsightId_key" ON "Insight"("supersedesInsightId");

-- CreateIndex
CREATE INDEX "Insight_organizationId_idx" ON "Insight"("organizationId");

-- CreateIndex
CREATE INDEX "Insight_analysisRunId_idx" ON "Insight"("analysisRunId");

-- CreateIndex
CREATE INDEX "Insight_organizationId_status_idx" ON "Insight"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Insight_organizationId_subjectIdentity_idx" ON "Insight"("organizationId", "subjectIdentity");

-- CreateIndex
CREATE INDEX "InsightEvidence_insightId_idx" ON "InsightEvidence"("insightId");

-- CreateIndex
CREATE INDEX "InsightEvidence_knowledgeItemId_idx" ON "InsightEvidence"("knowledgeItemId");

-- CreateIndex
CREATE INDEX "InsightEvidence_derivedInsightId_idx" ON "InsightEvidence"("derivedInsightId");

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insight" ADD CONSTRAINT "Insight_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insight" ADD CONSTRAINT "Insight_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insight" ADD CONSTRAINT "Insight_supersedesInsightId_fkey" FOREIGN KEY ("supersedesInsightId") REFERENCES "Insight"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightEvidence" ADD CONSTRAINT "InsightEvidence_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "Insight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightEvidence" ADD CONSTRAINT "InsightEvidence_derivedInsightId_fkey" FOREIGN KEY ("derivedInsightId") REFERENCES "Insight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────
-- Restricciones no expresables en schema.prisma — se añaden a mano.
-- UNDERSTANDING_ENGINE_DESIGN.md §12 ("Idempotencia bajo concurrencia") y §3.5.
-- ─────────────────────────────────────────────────────────────────────────

-- Idempotencia bajo concurrencia (§12): impide de forma DETERMINISTA y SIN BLOQUEOS que
-- dos AnalysisRun concurrentes creen dos Insight sobre el mismo asunto.
--
-- Definido por EXCLUSIÓN de los estados terminales, nunca por inclusión de los activos.
-- Es una decisión arquitectónica formal, no una preferencia (mismo criterio ya razonado en
-- KNOWLEDGE_ENGINE_DESIGN.md §7 para la idempotencia de la ingesta): el conjunto terminal es
-- cerrado y estable, mientras que el activo crece al enriquecerse el ciclo de vida. Ante un
-- estado nuevo todavía sin clasificar, el sistema falla del lado seguro (fail-closed): queda
-- protegido por defecto en vez de escaparse en silencio de la deduplicación.
--
-- CANDIDATE queda fuera a propósito: un candidato aún no es conocimiento vivo (§5).
-- Un Insight descartado o expirado nunca bloquea permanentemente una observación legítima
-- posterior del mismo asunto, precisamente por quedar fuera de la restricción.
CREATE UNIQUE INDEX "Insight_org_subject_active_key"
  ON "Insight" ("organizationId", "subjectIdentity")
  WHERE "status" = 'ACTIVE';

-- Integridad de la referencia polimórfica de evidencia (§3.5): exactamente una referencia
-- informada, y coherente con `kind`. Se valida también en dominio; aquí queda garantizado
-- a nivel de almacenamiento para que ninguna vía de escritura pueda saltárselo.
ALTER TABLE "InsightEvidence" ADD CONSTRAINT "InsightEvidence_ref_matches_kind"
  CHECK (
    (kind = 'KNOWLEDGE_ITEM'  AND "knowledgeItemId"  IS NOT NULL AND "knowledgeChunkId" IS NULL     AND "derivedInsightId" IS NULL) OR
    (kind = 'KNOWLEDGE_CHUNK' AND "knowledgeChunkId" IS NOT NULL AND "knowledgeItemId"  IS NULL     AND "derivedInsightId" IS NULL) OR
    (kind = 'DERIVED_INSIGHT' AND "derivedInsightId" IS NOT NULL AND "knowledgeItemId"  IS NULL     AND "knowledgeChunkId" IS NULL) OR
    (kind = 'CANONICAL_ENTITY' AND "knowledgeItemId" IS NULL     AND "knowledgeChunkId" IS NULL     AND "derivedInsightId" IS NULL)
  );

-- Un Insight nunca puede citarse a sí mismo como evidencia derivada. La aciclicidad completa
-- del grafo la garantiza la regla de dominio de solo citar Insight YA persistidos (§3.5); esto
-- cierra el único caso degenerado expresable en SQL.
ALTER TABLE "InsightEvidence" ADD CONSTRAINT "InsightEvidence_no_self_reference"
  CHECK ("derivedInsightId" IS NULL OR "derivedInsightId" <> "insightId");

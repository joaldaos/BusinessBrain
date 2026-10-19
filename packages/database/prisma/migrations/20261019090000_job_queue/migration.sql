-- Cola durable de trabajo diferido — Fase 9A.
--
-- Ver FASE-9A-9B-ARQUITECTURA-CERRADA.md §3.2 para por qué vive en Postgres y no en Redis.

CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'FAILED', 'DEAD');

CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "organizationId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- El índice que sostiene la reclamación de cada tic.
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");
CREATE INDEX "Job_organizationId_idx" ON "Job"("organizationId");

ALTER TABLE "Job" ADD CONSTRAINT "Job_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- No encolar dos veces lo mismo mientras siga vivo.
--
-- PARCIAL, y es la parte que importa: un trabajo cumplido se borra —así que su clave
-- vuelve a estar libre de inmediato— y uno muerto queda EXCLUIDO del índice, para que un
-- fallo permanente no impida para siempre volver a encolar esa misma tarea.
--
-- Prisma no sabe declarar un índice parcial, así que vive aquí y no en el schema.
CREATE UNIQUE INDEX "Job_dedupeKey_alive_key" ON "Job"("dedupeKey")
    WHERE "dedupeKey" IS NOT NULL AND "status" <> 'DEAD';

-- Un trabajo no puede nacer agotado: sin esto, `maxAttempts = 0` crearía una fila que
-- ningún tic puede completar ni matar.
ALTER TABLE "Job" ADD CONSTRAINT "Job_maxAttempts_positive"
    CHECK ("maxAttempts" >= 1);

-- Coherencia del arrendamiento: solo un trabajo reclamado tiene dueño, y tenerlo obliga a
-- saber desde cuándo. Sin ambas, la recuperación tras una caída no podría distinguir un
-- trabajo vivo de uno abandonado.
ALTER TABLE "Job" ADD CONSTRAINT "Job_lease_coherent"
    CHECK (
      ("status" = 'RUNNING' AND "lockedAt" IS NOT NULL AND "lockedBy" IS NOT NULL) OR
      ("status" <> 'RUNNING' AND "lockedAt" IS NULL AND "lockedBy" IS NULL)
    );

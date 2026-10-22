-- Ventanas de métrica y su uso como evidencia — Fase 9B.
--
-- Ver FASE-9A-9B-ARQUITECTURA-CERRADA.md §4.3 y §4.4. Esta migración RECREA una restricción
-- existente (`InsightEvidence_ref_matches_kind`), que es el único cambio de esta fase que
-- toca una regla ya desplegada. No toca datos: ninguna fila cambia de valor.

CREATE TABLE "BusinessMetricWindow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL DEFAULT '{}',
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessMetricWindow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BusinessMetricWindow_organizationId_metricKey_windowStart_idx"
    ON "BusinessMetricWindow"("organizationId", "metricKey", "windowStart");

-- Recalcular la misma ventana la actualiza; no crea una segunda.
CREATE UNIQUE INDEX "BusinessMetricWindow_organizationId_metricKey_dimensions_wi_key"
    ON "BusinessMetricWindow"("organizationId", "metricKey", "dimensions", "windowStart", "windowEnd");

ALTER TABLE "BusinessMetricWindow" ADD CONSTRAINT "BusinessMetricWindow_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Una muestra vacía no sostiene nada. Sin esto, `sampleSize = 0` produciría una evidencia
-- que parece respaldo y no respalda, que es peor que no tener evidencia.
ALTER TABLE "BusinessMetricWindow" ADD CONSTRAINT "BusinessMetricWindow_sample_not_empty"
    CHECK ("sampleSize" > 0);

-- Una ventana termina después de empezar. Al revés, cualquier filtro temporal la dejaría
-- fuera en silencio y la conclusión citaría una evidencia que nadie vuelve a encontrar.
ALTER TABLE "BusinessMetricWindow" ADD CONSTRAINT "BusinessMetricWindow_window_ordered"
    CHECK ("windowEnd" > "windowStart");

ALTER TABLE "InsightEvidence" ADD COLUMN "businessMetricId" TEXT;

CREATE INDEX "InsightEvidence_businessMetricId_idx"
    ON "InsightEvidence"("businessMetricId");

-- RESTRICT y no CASCADE: borrar una ventana dejaría viva una conclusión sin la evidencia que
-- la sostenía, que es justo lo que este modelo existe para impedir.
ALTER TABLE "InsightEvidence" ADD CONSTRAINT "InsightEvidence_businessMetricId_fkey"
    FOREIGN KEY ("businessMetricId") REFERENCES "BusinessMetricWindow"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── La restricción que se recrea ──────────────────────────────────────────────
--
-- `InsightEvidence_ref_matches_kind` garantiza que la referencia polimórfica sea coherente
-- con `kind`: exactamente una informada, y la que corresponde. Está puesta a propósito «para
-- que ninguna vía de escritura pueda saltárselo», así que ampliarla hay que hacerlo entero:
-- se elimina y se vuelve a crear incluyendo la clase nueva y excluyéndola de las anteriores.
--
-- Si se añadiera solo la rama nueva sin tocar las viejas, un `kind = 'KNOWLEDGE_ITEM'` con
-- `businessMetricId` informado pasaría la comprobación.
ALTER TABLE "InsightEvidence" DROP CONSTRAINT "InsightEvidence_ref_matches_kind";

ALTER TABLE "InsightEvidence" ADD CONSTRAINT "InsightEvidence_ref_matches_kind"
  CHECK (
    (kind = 'KNOWLEDGE_ITEM'   AND "knowledgeItemId"  IS NOT NULL AND "knowledgeChunkId" IS NULL AND "derivedInsightId" IS NULL AND "businessMetricId" IS NULL) OR
    (kind = 'KNOWLEDGE_CHUNK'  AND "knowledgeChunkId" IS NOT NULL AND "knowledgeItemId"  IS NULL AND "derivedInsightId" IS NULL AND "businessMetricId" IS NULL) OR
    (kind = 'DERIVED_INSIGHT'  AND "derivedInsightId" IS NOT NULL AND "knowledgeItemId"  IS NULL AND "knowledgeChunkId" IS NULL AND "businessMetricId" IS NULL) OR
    (kind = 'BUSINESS_METRIC'  AND "businessMetricId" IS NOT NULL AND "knowledgeItemId"  IS NULL AND "knowledgeChunkId" IS NULL AND "derivedInsightId" IS NULL) OR
    (kind = 'CANONICAL_ENTITY' AND "knowledgeItemId"  IS NULL     AND "knowledgeChunkId" IS NULL AND "derivedInsightId" IS NULL AND "businessMetricId" IS NULL)
  );

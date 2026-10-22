-- Nueva clase de evidencia: una métrica calculada sobre hechos — Fase 9B.
--
-- VA SOLA, y no por gusto: Postgres no permite USAR un valor de enum en la misma transacción
-- en la que se añade. La restricción CHECK que lo menciona vive en la migración siguiente, que
-- se ejecuta después de que esta haya confirmado.

ALTER TYPE "InsightEvidenceKind" ADD VALUE 'BUSINESS_METRIC';

-- Una fila por empresa, metrica y periodo.
--
-- Sin esta restriccion, dos vectorizaciones simultaneas de la misma empresa crearian dos filas
-- del mismo dia y el tope diario de uso de IA se contaria por la mitad. Es ademas lo que
-- permite incrementar el contador de forma atomica en vez de leer, sumar y guardar.
CREATE UNIQUE INDEX "UsageRecord_organizationId_metric_periodStart_key"
  ON "UsageRecord"("organizationId", "metric", "periodStart");

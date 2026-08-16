-- Fase 6 — reclamacion de automatizaciones vencidas sin cerrojo aplicativo.
--
-- `nextRunAt` permite que reclamar lo vencido sea UNA escritura condicional: varias
-- instancias del backend compiten por la misma fila y solo una gana. Calcular el vencimiento
-- en memoria en cada tic habria hecho que dos procesos dispararan la misma automatizacion.
ALTER TABLE "Automation" ADD COLUMN "nextRunAt" TIMESTAMP(3);

-- Sostiene el barrido: se consulta por fecha y estado, nunca por organizacion. Es el unico
-- indice del sistema que cruza tenants a proposito, porque el reloj es de la plataforma.
CREATE INDEX "Automation_nextRunAt_status_idx" ON "Automation" ("nextRunAt", "status");

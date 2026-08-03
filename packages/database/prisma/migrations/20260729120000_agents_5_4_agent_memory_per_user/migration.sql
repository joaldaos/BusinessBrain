-- Fase 5, subfase 5.4 — la memoria del agente pasa a ser PRIVADA DE CADA USUARIO.
--
-- Las conversaciones ya estan aisladas por organizacion Y usuario desde la Fase 4. Una
-- memoria compartida entre usuarios del mismo tenant romperia ese aislamiento por la puerta
-- de atras: lo que el agente aprendiera de la conversacion de una persona aflorararia en la
-- de otra. Por eso `userId` es NOT NULL y no existe memoria organizacional compartida.
--
-- Migracion ADITIVA sobre una tabla vacia: ningun camino de codigo ha escrito nunca en
-- AgentMemory. Si existieran filas, este ALTER fallaria en voz alta en vez de inventar un
-- propietario para datos que no lo tienen — que es exactamente el comportamiento deseado.

-- AlterTable
ALTER TABLE "AgentMemory" ADD COLUMN "userId" TEXT NOT NULL;

-- El indice antiguo no cubre el nuevo alcance completo.
DROP INDEX IF EXISTS "AgentMemory_agentId_organizationId_idx";

-- CreateIndex: alcance completo agentId + organizationId + userId
CREATE INDEX "AgentMemory_agentId_organizationId_userId_idx" ON "AgentMemory"("agentId", "organizationId", "userId");

-- CreateIndex: una clave identifica un hecho por usuario y agente. Sin unicidad, recordar
-- algo dos veces crearia dos verdades simultaneas sin criterio de desempate.
CREATE UNIQUE INDEX "AgentMemory_agentId_userId_key_key" ON "AgentMemory"("agentId", "userId", "key");

-- AddForeignKey: sin estas claves ajenas, `organizationId` y `userId` serian columnas de
-- filtrado sin garantia, capaces de desincronizarse de la organizacion real del agente.
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

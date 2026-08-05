-- Fase 5, subfase 5.8 — ciclo de vida de Recommendation y acceso por persona a colecciones.
--
-- Migracion ENTERAMENTE ADITIVA: una columna nullable, una tabla nueva, indices y claves
-- foraneas. No altera ni borra ninguna columna existente, asi que no puede perder datos ni
-- romper a un consumidor anterior.
--
-- 1) Recommendation.resolvedById
--    Aceptar o descartar es una DECISION HUMANA, no un cambio de estado administrativo
--    (BUSINESSBRAIN_MIGRATION_PLAN.md §3.2, UNDERSTANDING_ENGINE_DESIGN.md §11: una
--    propuesta "requiere aprobacion explicita"). Ya existia `resolvedAt`, de modo que se
--    sabia CUANDO se resolvio pero no QUIEN lo decidio — una aprobacion sin aprobador
--    registrado no es auditable. Nullable porque las recomendaciones en estado NEW no
--    tienen resolutor, y ON DELETE SET NULL porque la decision debe sobrevivir a la baja de
--    quien la tomo, igual que un Agent desactivado conserva la trazabilidad de lo que
--    produjo.
--
-- 2) KnowledgeCollectionAccess
--    Hasta aqui el alcance de coleccion solo existia para AGENTES (AgentKnowledgeScope). El
--    Understanding Engine acota la comprension —y las Recommendation derivadas de ella— por
--    EffectiveCollectionScope (§3.4, §12), y esa regla se compara contra las colecciones a
--    las que el CONSUMIDOR tiene acceso concedido. Sin esta tabla ese consumidor no podia
--    ser una persona: no habia forma de expresar que alguien tiene acceso a Ventas pero no
--    a RR. HH., de modo que una Recommendation sostenida por evidencia restringida habria
--    sido visible para cualquier miembro de la organizacion.
--
--    El acceso se CONCEDE, nunca se presupone (KNOWLEDGE_ENGINE_DESIGN.md §535): no tener
--    ninguna fila aqui significa no tener acceso a ninguna coleccion, no a todas.
--
--    Dos decisiones de integridad referencial que no son cosmeticas:
--    - La concesion cuelga de la MEMBRESIA (userId, organizationId), no del usuario suelto:
--      salir de la organizacion revoca en cascada todo lo concedido en ella. Un acceso que
--      sobreviviera a la baja seria exactamente el permiso que nadie recuerda retirar.
--    - La coleccion se referencia por la clave COMPUESTA (id, organizationId), lo que hace
--      imposible por construccion conceder una coleccion de otra organizacion. Comprobarlo
--      solo en el servicio dejaria la garantia a merced de la siguiente via de escritura.
--      De ahi el UNIQUE (id, organizationId) sobre KnowledgeCollection, redundante con la
--      PK pero necesario como destino de esa FK compuesta.

-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN     "resolvedById" TEXT;

-- CreateTable
CREATE TABLE "KnowledgeCollectionAccess" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "knowledgeCollectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeCollectionAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeCollectionAccess_organizationId_userId_idx" ON "KnowledgeCollectionAccess"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "KnowledgeCollectionAccess_userId_idx" ON "KnowledgeCollectionAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCollectionAccess_knowledgeCollectionId_userId_key" ON "KnowledgeCollectionAccess"("knowledgeCollectionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCollection_id_organizationId_key" ON "KnowledgeCollection"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Recommendation_resolvedById_idx" ON "Recommendation"("resolvedById");

-- AddForeignKey
ALTER TABLE "KnowledgeCollectionAccess" ADD CONSTRAINT "KnowledgeCollectionAccess_userId_organizationId_fkey" FOREIGN KEY ("userId", "organizationId") REFERENCES "Membership"("userId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCollectionAccess" ADD CONSTRAINT "KnowledgeCollectionAccess_knowledgeCollectionId_organizati_fkey" FOREIGN KEY ("knowledgeCollectionId", "organizationId") REFERENCES "KnowledgeCollection"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCollectionAccess" ADD CONSTRAINT "KnowledgeCollectionAccess_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


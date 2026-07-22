-- CreateEnum
CREATE TYPE "KnowledgeItemLineageEdgeType" AS ENUM ('UPDATES', 'SPLIT_FROM', 'MERGED_FROM', 'DUPLICATE_OF', 'RESTORED_FROM');

-- NOTA (revisión manual antes de aplicar, subfase 2.2): igual que en las migraciones de 2.1 y del
-- prerrequisito N:M de colecciones, Prisma generó aquí un "DROP INDEX
-- KnowledgeChunk_embedding_hnsw_idx" que no corresponde a ningún cambio de esta migración
-- (KnowledgeChunk no se toca). Se elimina esa línea de forma deliberada por el mismo motivo ya
-- documentado en esas migraciones: el motor de diff de Prisma no reconoce índices sobre columnas
-- "Unsupported(vector(N))" como gestionados y los marca para eliminar en cualquier migración
-- posterior.

-- CreateTable
CREATE TABLE "KnowledgeItemLineageEdge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromKnowledgeItemId" TEXT NOT NULL,
    "toKnowledgeItemId" TEXT NOT NULL,
    "type" "KnowledgeItemLineageEdgeType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeItemLineageEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeItemLineageEdge_organizationId_idx" ON "KnowledgeItemLineageEdge"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeItemLineageEdge_fromKnowledgeItemId_idx" ON "KnowledgeItemLineageEdge"("fromKnowledgeItemId");

-- CreateIndex
CREATE INDEX "KnowledgeItemLineageEdge_toKnowledgeItemId_idx" ON "KnowledgeItemLineageEdge"("toKnowledgeItemId");

-- AddForeignKey
ALTER TABLE "KnowledgeItemLineageEdge" ADD CONSTRAINT "KnowledgeItemLineageEdge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItemLineageEdge" ADD CONSTRAINT "KnowledgeItemLineageEdge_fromKnowledgeItemId_fkey" FOREIGN KEY ("fromKnowledgeItemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItemLineageEdge" ADD CONSTRAINT "KnowledgeItemLineageEdge_toKnowledgeItemId_fkey" FOREIGN KEY ("toKnowledgeItemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SQL manual (no expresable en schema.prisma: Prisma no soporta índices únicos parciales/
-- filtrados en su DSL). KNOWLEDGE_ENGINE_DESIGN.md §7, "Especificación de idempotencia bajo
-- concurrencia — niveles 1 y 2" (Revisión formal — Subfase 2.2, hallazgo D, cerrado): garantiza
-- que dos ingestas concurrentes del mismo contenido, para la misma organización, nunca puedan
-- coexistir como dos KnowledgeItem "vivos" con el mismo hash. Definido por EXCLUSIÓN de los
-- estados terminales (§3.5) — no por inclusión de los activos — para que el sistema falle en la
-- dirección segura (fail-closed) ante cualquier estado futuro del enum que no se haya clasificado
-- todavía; ver la regla arquitectónica de §3.5 y su test de imposición en CI
-- (knowledge-item-status.classification.spec.ts).
CREATE UNIQUE INDEX "KnowledgeItem_org_contentHash_active_key"
ON "KnowledgeItem" ("organizationId", "contentHash")
WHERE "status" NOT IN ('SUPERSEDED', 'FAILED', 'DELETED');

-- SQL manual (mismo motivo: sin soporte de índices únicos parciales en el DSL de Prisma).
-- KNOWLEDGE_ENGINE_DESIGN.md §6, "Reglas transversales": "un KnowledgeItem puede tener como
-- máximo un predecesor directo por tipo ACTUALIZA (una cadena lineal de versiones)". Garantiza esa
-- regla a nivel de base de datos, no solo de disciplina de aplicación: cada KnowledgeItem puede
-- ser el origen ("From") de como mucho una arista UPDATES.
CREATE UNIQUE INDEX "KnowledgeItemLineageEdge_updates_from_key"
ON "KnowledgeItemLineageEdge" ("fromKnowledgeItemId")
WHERE "type" = 'UPDATES';

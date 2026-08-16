-- A que colecciones va a parar el conocimiento que entra por una fuente.
--
-- Sin esto, un documento recien ingerido no pertenecia a ninguna coleccion, su alcance
-- efectivo era vacio y —por la regla fail-closed de alcance vacio— NADIE podia ver la
-- comprension derivada de el. El motor funcionaba entero y el producto no servia para nada:
-- subir un documento, analizarlo y no ver ni una conclusion.
CREATE UNIQUE INDEX "KnowledgeSource_id_organizationId_key"
  ON "KnowledgeSource" ("id", "organizationId");

CREATE TABLE "KnowledgeSourceCollection" (
  "knowledgeSourceId"     TEXT NOT NULL,
  "knowledgeCollectionId" TEXT NOT NULL,
  "organizationId"        TEXT NOT NULL,

  CONSTRAINT "KnowledgeSourceCollection_pkey"
    PRIMARY KEY ("knowledgeSourceId", "knowledgeCollectionId")
);

CREATE INDEX "KnowledgeSourceCollection_organizationId_idx"
  ON "KnowledgeSourceCollection" ("organizationId");

-- Las claves foraneas son COMPUESTAS con la organizacion: hacen imposible a nivel de base de
-- datos que una fuente apunte a la coleccion de otro tenant.
ALTER TABLE "KnowledgeSourceCollection"
  ADD CONSTRAINT "KnowledgeSourceCollection_source_fkey"
  FOREIGN KEY ("knowledgeSourceId", "organizationId")
  REFERENCES "KnowledgeSource" ("id", "organizationId") ON DELETE CASCADE;

ALTER TABLE "KnowledgeSourceCollection"
  ADD CONSTRAINT "KnowledgeSourceCollection_collection_fkey"
  FOREIGN KEY ("knowledgeCollectionId", "organizationId")
  REFERENCES "KnowledgeCollection" ("id", "organizationId") ON DELETE CASCADE;

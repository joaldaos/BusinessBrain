-- Relacion INEQUIVOCA entre una conexion externa y las fuentes que autoriza.
--
-- Hasta ahora `Integration` y `KnowledgeSource` eran dos tablas sueltas: una guardaba las
-- credenciales OAuth y la otra la fuente que las necesitaba, sin ninguna forma de decir "esta
-- fuente de Drive usa esta conexion". Sin ella, revocar el acceso a Google no podria detener
-- las sincronizaciones que dependian de el — que es justo lo que un usuario espera al pulsar
-- "desconectar".
CREATE UNIQUE INDEX "Integration_id_organizationId_key"
  ON "Integration" ("id", "organizationId");

ALTER TABLE "KnowledgeSource" ADD COLUMN "integrationId" TEXT;

-- Marcador de la ultima sincronizacion. No es un secreto, asi que no va en `configEnc`.
ALTER TABLE "KnowledgeSource" ADD COLUMN "syncCursor" JSONB;

-- Clave foranea COMPUESTA con la organizacion: hace imposible a nivel de base de datos que
-- una fuente use la conexion de otro tenant.
--
-- `ON DELETE SET NULL` y no CASCADE: borrar una conexion no puede llevarse por delante el
-- conocimiento ya ingerido. La fuente queda sin conexion —y por tanto sin poder
-- sincronizar—, pero sus documentos siguen ahi.
ALTER TABLE "KnowledgeSource"
  ADD CONSTRAINT "KnowledgeSource_integration_fkey"
  FOREIGN KEY ("integrationId", "organizationId")
  REFERENCES "Integration" ("id", "organizationId") ON DELETE SET NULL;

CREATE INDEX "KnowledgeSource_integrationId_idx" ON "KnowledgeSource" ("integrationId");

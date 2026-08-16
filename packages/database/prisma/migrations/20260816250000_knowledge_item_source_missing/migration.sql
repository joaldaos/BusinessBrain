-- Senal NO destructiva: el documento ya no esta en la fuente sincronizada que lo trajo.
--
-- No es un estado del ciclo de vida y por eso no se anade a `KnowledgeItemStatus`: el item
-- sigue siendo conocimiento valido, con contenido, linaje y versiones intactos. Es un atributo
-- del mismo item, como la confianza o la pertenencia a colecciones, que §5 ya permite cambiar
-- sin crear una version nueva.
--
-- Se distingue de ELIMINADO por construccion: ELIMINADO es una decision humana registrada como
-- estado; esto es una observacion del sincronizador que se limpia sola si el documento vuelve.
ALTER TABLE "KnowledgeItem" ADD COLUMN "sourceMissingSince" TIMESTAMP(3);

-- Sostiene la lectura "que hay ausente en esta fuente", que es la unica consulta que lo usa.
CREATE INDEX "KnowledgeItem_sourceMissing_idx"
  ON "KnowledgeItem" ("currentKnowledgeSourceId", "sourceMissingSince");

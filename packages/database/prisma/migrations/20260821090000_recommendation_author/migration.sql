-- Quién REDACTÓ la propuesta.
--
-- `NULL` significa que la propuso BusinessBrain a partir de una conclusión; con valor, la
-- redactó esa persona escalando manualmente. Es la única distinción que el modelo no podía
-- representar, y hace falta: una PYME tiene que poder saber si detrás de una propuesta hay
-- alguien de su empresa o es el sistema quien la sugiere. No son lo mismo a la hora de
-- decidir, y presentarlas igual sería engañoso.
--
-- Se elige un autor en vez de una bandera de origen porque responde a las dos preguntas —de
-- dónde viene Y quién la escribió— y porque es exactamente el mismo patrón que `resolvedById`,
-- con la misma semántica: la propuesta sobrevive a la baja de quien la redactó, igual que la
-- decisión sobrevive a la baja de quien la tomó.
ALTER TABLE "Recommendation" ADD COLUMN "createdById" TEXT;

ALTER TABLE "Recommendation"
  ADD CONSTRAINT "Recommendation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Recommendation_createdById_idx" ON "Recommendation"("createdById");

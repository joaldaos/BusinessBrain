-- Gmail como proveedor de integracion.
ALTER TYPE "IntegrationProvider" ADD VALUE 'GMAIL';

-- Metadata OPERATIVA de la fuente: lo que nos dijo y NO es conocimiento.
--
-- Separa de forma tajante las dos cosas: `contentText` es lo que se indexa, se trocea, se
-- vectoriza y se recupera; esto sirve para sincronizar, agrupar o trazar, y nunca debe acabar
-- en un embedding ni en un informe.
--
-- Contenedor generico, no de un conector concreto: hoy guarda el hilo de un correo y la
-- direccion de su remitente —dato personal que por decision de producto queda fuera del
-- conocimiento recuperable—, y manana lo que necesite otra fuente.
ALTER TABLE "KnowledgeItem" ADD COLUMN "sourceMetadata" JSONB;

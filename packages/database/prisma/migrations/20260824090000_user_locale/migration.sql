-- Idioma elegido por cada persona para la interfaz y para las respuestas del chat.
--
-- Nulo = no ha elegido todavia: la interfaz usa el idioma del navegador. Texto y no un enum
-- porque anadir un idioma nuevo debe ser una entrada en una lista de codigo, no una migracion.
ALTER TABLE "User" ADD COLUMN "locale" TEXT;

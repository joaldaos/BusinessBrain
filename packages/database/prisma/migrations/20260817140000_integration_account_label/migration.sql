-- La cuenta externa a la que quedó conectada la integración, en texto legible.
--
-- Existe para que un administrador pueda saber QUÉ buzón alimenta al sistema. Sin esto, la
-- pantalla solo puede decir "Gmail conectado", y en una empresa con varias cuentas eso no
-- permite auditar nada ni decidir si conviene desconectar.
--
-- Es identidad de la CONEXIÓN, no contenido: no se indexa, no se recupera y no participa en
-- ninguna respuesta del motor de conocimiento — a diferencia de la dirección del remitente de
-- un mensaje, que queda deliberadamente fuera del conocimiento recuperable.
ALTER TABLE "Integration" ADD COLUMN "accountLabel" TEXT;

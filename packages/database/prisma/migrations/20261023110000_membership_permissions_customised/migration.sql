-- Marca de permisos ajustados a mano.
--
-- Sin ella, cero filas en `MembershipPermission` significaría dos cosas opuestas: «nunca se
-- tocó», y entonces vale lo que diga el rol, y «se le quitó todo», y entonces no puede nada.
-- Con la misma representación, quitarle todos los permisos a alguien se los habría devuelto
-- íntegros — justo lo contrario de lo que quien administra acababa de decidir.
--
-- `false` por defecto: toda membresía existente queda como estaba, que es lo que se pretende.

ALTER TABLE "Membership" ADD COLUMN "permissionsCustomised" BOOLEAN NOT NULL DEFAULT false;

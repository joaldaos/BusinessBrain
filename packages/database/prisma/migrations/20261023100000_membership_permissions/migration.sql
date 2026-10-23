-- Permisos granulares por módulo y acción.
--
-- NO hay relleno de datos, y es deliberado: una membresía SIN filas aquí significa «lo que
-- diga su rol», que es exactamente como se comportaba el sistema antes de esta tabla. Así
-- introducir los permisos no cambia el comportamiento de ninguna empresa el primer día.
--
-- Rellenarla con el equivalente de cada rol habría parecido más prolijo y habría sido peor:
-- congelaría hoy la traducción rol → permisos, y el día que esa traducción cambie —porque el
-- producto gane un módulo— las empresas que nunca tocaron sus permisos se quedarían con la
-- foto vieja sin que nadie lo hubiera decidido.

CREATE TABLE "MembershipPermission" (
    "membershipId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipPermission_pkey" PRIMARY KEY ("membershipId","permission")
);

-- Para responder «¿quién puede ver la facturación?» con un índice y no recorriendo
-- membresías. Es la consulta que justifica que esto sean filas y no una columna JSON.
CREATE INDEX "MembershipPermission_permission_idx" ON "MembershipPermission"("permission");

ALTER TABLE "MembershipPermission" ADD CONSTRAINT "MembershipPermission_membershipId_fkey"
    FOREIGN KEY ("membershipId") REFERENCES "Membership"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Un permiso con formato imposible no llega a guardarse. El catálogo vive en el código y es
-- quien decide qué existe, pero esto impide que una cadena vacía o sin separador ocupe una
-- fila que nadie podrá interpretar después.
ALTER TABLE "MembershipPermission" ADD CONSTRAINT "MembershipPermission_shape"
    CHECK ("permission" ~ '^[A-Z_]+:[A-Z_]+$');

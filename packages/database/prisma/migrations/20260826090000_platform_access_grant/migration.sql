-- Acceso administrativo a los datos de UNA empresa: motivado, acotado y caducable.
--
-- No cuelga de una Membership a proposito. Quien administra la plataforma no tiene ni puede
-- tener membresia, asi que colgar de "User" y "Organization" por separado es lo que hace que
-- una concesion no pueda convertirse nunca en pertenencia: son dos tablas de forma distinta.
--
-- "expiresAt" es NOT NULL: no existe forma de escribir una concesion indefinida.
CREATE TYPE "PlatformAccessScope" AS ENUM ('METADATA', 'DIAGNOSTICS', 'CONTENT');
CREATE TYPE "PlatformAccessStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

CREATE TABLE "PlatformAccessGrant" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "scope"          "PlatformAccessScope" NOT NULL,
  "status"         "PlatformAccessStatus" NOT NULL DEFAULT 'ACTIVE',
  "reason"         TEXT NOT NULL,
  "requestedById"  TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedById"   TEXT,
  "approvedAt"     TIMESTAMP(3),
  "revokedById"    TEXT,
  "revokedAt"      TIMESTAMP(3),
  "expiresAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlatformAccessGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformAccessGrant_organizationId_scope_status_idx"
  ON "PlatformAccessGrant"("organizationId", "scope", "status");
CREATE INDEX "PlatformAccessGrant_requestedById_idx"
  ON "PlatformAccessGrant"("requestedById");

ALTER TABLE "PlatformAccessGrant" ADD CONSTRAINT "PlatformAccessGrant_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformAccessGrant" ADD CONSTRAINT "PlatformAccessGrant_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformAccessGrant" ADD CONSTRAINT "PlatformAccessGrant_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlatformAccessGrant" ADD CONSTRAINT "PlatformAccessGrant_revokedById_fkey"
  FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

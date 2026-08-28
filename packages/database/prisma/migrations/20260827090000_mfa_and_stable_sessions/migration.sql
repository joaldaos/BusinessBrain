-- Verificación en dos pasos y sesión estable — Fase 4.
--
-- ## Por qué esta migración cierra las sesiones abiertas
--
-- `RefreshToken` pasa a colgar de una sesión, y la columna es OBLIGATORIA. Los tokens que ya
-- existen no pertenecen a ninguna: nacieron antes de que las sesiones existieran.
--
-- Se podría inventar una sesión por token para conservarlos. Sería peor: esas sesiones tendrían
-- una fecha de creación falsa y una ventana de reautenticación heredada de la nada, y la
-- primera pregunta seria sobre ellas —"¿cuándo empezó esta sesión?"— tendría una respuesta
-- inventada. Se borran, y todo el mundo vuelve a entrar una vez.

-- ── La sesión ───────────────────────────────────────────────────────────────
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reauthenticatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Los tokens de refresco pasan a colgar de una sesión ─────────────────────
-- Ver la cabecera: los existentes no pertenecen a ninguna y no se les puede inventar una.
DELETE FROM "RefreshToken";

ALTER TABLE "RefreshToken" ADD COLUMN "sessionId" TEXT NOT NULL;

CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");

ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Los códigos de recuperación ─────────────────────────────────────────────
CREATE TABLE "MfaRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MfaRecoveryCode_userId_codeHash_idx" ON "MfaRecoveryCode"("userId", "codeHash");

ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── El segundo factor en la cuenta ──────────────────────────────────────────
-- `mfaSecretEnc` va cifrado y no con hash: verificar un código TOTP exige recalcularlo, y para
-- eso hace falta el secreto original.
ALTER TABLE "User" ADD COLUMN "mfaSecretEnc" TEXT;
ALTER TABLE "User" ADD COLUMN "mfaEnabledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "mfaFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "mfaLockedUntil" TIMESTAMP(3);

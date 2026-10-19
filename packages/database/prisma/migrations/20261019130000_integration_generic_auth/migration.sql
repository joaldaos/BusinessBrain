-- Credenciales genéricas en Integration — Fase 9A/9B, cambio 4.5.
--
-- Las columnas existentes tienen forma de OAuth de Google. Un TPV con clave de API no cabe
-- ahí. Esto generaliza sin tocar nada de lo que ya funciona: no se migra ninguna fila y las
-- conexiones de Google siguen usando sus columnas.

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "authKind" "ConnectorAuthKind" NOT NULL DEFAULT 'OAUTH2',
ADD COLUMN     "connectorKey" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "secretEnc" TEXT;


-- Registro de hechos empresariales — Fase 9A, la vía NO documental.
--
-- Ver FASE-9A-9B-ARQUITECTURA-CERRADA.md §4.1: dos tablas cubren los trece conceptos que se
-- plantearon sin construir un ERP. Unos son cosas que persisten; otros, cosas que ocurren.

CREATE TYPE "BusinessEntityKind" AS ENUM ('CUSTOMER', 'SUPPLIER', 'PRODUCT', 'EMPLOYEE', 'LOCATION');

CREATE TYPE "BusinessEventKind" AS ENUM (
  'ORDER_PLACED', 'ORDER_SENT_TO_KITCHEN', 'ORDER_ITEM_READY', 'ORDER_COMPLETED',
  'ORDER_CANCELLED', 'SALE_RECORDED', 'INVOICE_ISSUED', 'PAYMENT_RECEIVED'
);

CREATE TABLE "BusinessEntity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "kind" "BusinessEntityKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BusinessEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "kind" "BusinessEventKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amountCents" INTEGER,
    "currency" TEXT,
    "quantity" DECIMAL(65,30),
    "subjectId" TEXT,
    "correlationId" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "BusinessEvent_pkey" PRIMARY KEY ("id")
);

-- El mismo maestro entre dos sincronizaciones es uno solo.
CREATE UNIQUE INDEX "BusinessEntity_organizationId_connectorId_kind_externalId_key"
    ON "BusinessEntity"("organizationId", "connectorId", "kind", "externalId");
CREATE INDEX "BusinessEntity_organizationId_kind_idx"
    ON "BusinessEntity"("organizationId", "kind");

-- LA garantía de idempotencia: un webhook reenviado, un reintento o dos ventanas de sondeo
-- solapadas no pueden duplicar una venta. Un duplicado aquí es facturación inventada.
CREATE UNIQUE INDEX "BusinessEvent_organizationId_connectorId_kind_externalId_key"
    ON "BusinessEvent"("organizationId", "connectorId", "kind", "externalId");
CREATE INDEX "BusinessEvent_organizationId_kind_occurredAt_idx"
    ON "BusinessEvent"("organizationId", "kind", "occurredAt");
CREATE INDEX "BusinessEvent_organizationId_correlationId_idx"
    ON "BusinessEvent"("organizationId", "correlationId");
CREATE INDEX "BusinessEvent_subjectId_idx" ON "BusinessEvent"("subjectId");

ALTER TABLE "BusinessEntity" ADD CONSTRAINT "BusinessEntity_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessEvent" ADD CONSTRAINT "BusinessEvent_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- El maestro al que apunta un hecho tiene que ser de LA MISMA empresa.
--
-- Por eso la clave foránea es COMPUESTA y no apunta solo al id: con una clave simple, un
-- `subjectId` equivocado —o malicioso— ligaría el hecho de una empresa al cliente de otra, y
-- ninguna comprobación de la aplicación lo impediría a nivel de almacenamiento. Es el mismo
-- patrón que ya usan `KnowledgeSource` e `Integration`.
CREATE UNIQUE INDEX "BusinessEntity_id_organizationId_key"
    ON "BusinessEntity"("id", "organizationId");

ALTER TABLE "BusinessEvent" ADD CONSTRAINT "BusinessEvent_subjectId_organizationId_fkey"
    FOREIGN KEY ("subjectId", "organizationId")
    REFERENCES "BusinessEntity"("id", "organizationId")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Un importe sin moneda no se puede sumar con nada, y una moneda sin importe no significa
-- nada. O vienen los dos o no viene ninguno: así ninguna media puede mezclar euros con lo
-- que fuera que trajo el conector.
ALTER TABLE "BusinessEvent" ADD CONSTRAINT "BusinessEvent_amount_needs_currency"
    CHECK (("amountCents" IS NULL) = ("currency" IS NULL));

-- Una cantidad negativa no es una devolución: una devolución es su propio hecho, con su
-- propia fecha. Permitirla aquí haría que una suma de ventas se "corrigiera" sola y que el
-- rastro de lo que pasó desapareciera dentro de un agregado.
ALTER TABLE "BusinessEvent" ADD CONSTRAINT "BusinessEvent_quantity_not_negative"
    CHECK ("quantity" IS NULL OR "quantity" >= 0);

-- Historial de inventario: cada cambio de Product.stock deja un movimiento
-- (ingreso de mercadería, venta, anulación, ajuste por conteo, merma, edición manual).
CREATE TYPE "StockMovementType" AS ENUM ('INITIAL', 'PURCHASE', 'SALE', 'SALE_REVERSAL', 'ADJUSTMENT', 'WASTE', 'MANUAL_EDIT');

CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "stockBefore" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "groupId" TEXT,
    "supplier" TEXT,
    "documentNumber" TEXT,
    "unitCost" DECIMAL(10,2),
    "reason" TEXT,
    "accountId" TEXT,
    "accountItemId" TEXT,
    "createdByUserId" INTEGER,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockMovement_clubId_occurredAt_idx" ON "StockMovement"("clubId", "occurredAt");
CREATE INDEX "StockMovement_clubId_productId_occurredAt_idx" ON "StockMovement"("clubId", "productId", "occurredAt");
CREATE INDEX "StockMovement_clubId_type_occurredAt_idx" ON "StockMovement"("clubId", "type", "occurredAt");
CREATE INDEX "StockMovement_groupId_idx" ON "StockMovement"("groupId");

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

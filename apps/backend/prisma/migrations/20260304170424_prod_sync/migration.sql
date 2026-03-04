-- AlterTable
ALTER TABLE "CashMovement" ADD COLUMN     "guestDni" TEXT,
ADD COLUMN     "guestName" TEXT,
ADD COLUMN     "guestPhone" TEXT,
ADD COLUMN     "isSettled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "userId" INTEGER;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isCombo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProductComponent" (
    "id" SERIAL NOT NULL,
    "parentProductId" INTEGER NOT NULL,
    "componentProductId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ProductComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductComponent_parentProductId_idx" ON "ProductComponent"("parentProductId");

-- CreateIndex
CREATE INDEX "ProductComponent_componentProductId_idx" ON "ProductComponent"("componentProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductComponent_parentProductId_componentProductId_key" ON "ProductComponent"("parentProductId", "componentProductId");

-- CreateIndex
CREATE INDEX "CashMovement_clubId_userId_idx" ON "CashMovement"("clubId", "userId");

-- AddForeignKey
ALTER TABLE "ProductComponent" ADD CONSTRAINT "ProductComponent_parentProductId_fkey" FOREIGN KEY ("parentProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductComponent" ADD CONSTRAINT "ProductComponent_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "collectorAccountLabel" TEXT,
ADD COLUMN "externalReference" TEXT;

-- CreateIndex
CREATE INDEX "Payment_externalReference_idx" ON "Payment"("externalReference");

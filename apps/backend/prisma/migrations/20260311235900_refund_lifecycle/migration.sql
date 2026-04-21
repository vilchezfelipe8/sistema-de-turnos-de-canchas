-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'READY_TO_EXECUTE', 'EXECUTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundExecutionMethod" AS ENUM ('CASH', 'TRANSFER', 'CARD_REVERSAL', 'MP_REFUND', 'CREDIT_NOTE', 'OTHER');

-- CreateEnum
CREATE TYPE "RefundReasonType" AS ENUM ('FULL', 'PARTIAL_COMMERCIAL', 'PARTIAL_SERVICE_FAILURE', 'PARTIAL_PRICING_ERROR', 'OTHER');

-- AlterTable
ALTER TABLE "Refund"
ADD COLUMN "reasonType" "RefundReasonType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
ADD COLUMN "executionMethod" "RefundExecutionMethod",
ADD COLUMN "approvedAt" TIMESTAMPTZ(3),
ADD COLUMN "approvedByUserId" INTEGER,
ADD COLUMN "executedAt" TIMESTAMPTZ(3),
ADD COLUMN "executedByUserId" INTEGER,
ADD COLUMN "cancelledAt" TIMESTAMPTZ(3),
ADD COLUMN "cancelledByUserId" INTEGER,
ADD COLUMN "cancelReason" TEXT,
ADD COLUMN "executionReference" TEXT,
ADD COLUMN "executionNotes" TEXT,
ADD COLUMN "failedAt" TIMESTAMPTZ(3),
ADD COLUMN "failedReason" TEXT;

-- CreateIndex
CREATE INDEX "Refund_status_createdAt_idx" ON "Refund"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Refund"
ADD CONSTRAINT "Refund_approvedByUserId_fkey"
FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund"
ADD CONSTRAINT "Refund_executedByUserId_fkey"
FOREIGN KEY ("executedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund"
ADD CONSTRAINT "Refund_cancelledByUserId_fkey"
FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

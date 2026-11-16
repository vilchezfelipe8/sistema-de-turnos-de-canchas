-- AlterEnum
ALTER TYPE "ClassSeriesMemberStatus" ADD VALUE 'AWAITING_PAYMENT';

-- AlterTable
ALTER TABLE "ClassSeries" ADD COLUMN     "requiresPayment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OnlinePaymentAttempt" ADD COLUMN     "classSeriesMemberId" TEXT,
ALTER COLUMN "bookingId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "OnlinePaymentAttempt_classSeriesMemberId_idx" ON "OnlinePaymentAttempt"("classSeriesMemberId");


-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('AUTO', 'CASH_DRAWER', 'BANK_ACCOUNT', 'CARD_TERMINAL', 'VIRTUAL_WALLET', 'OTHER');

-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "channel" "PaymentChannel" NOT NULL DEFAULT 'AUTO';

-- Data migration for existing payments
UPDATE "Payment"
SET "channel" = CASE
  WHEN "method" = 'CASH'::"PaymentMethod" THEN 'CASH_DRAWER'::"PaymentChannel"
  WHEN "method" = 'CARD'::"PaymentMethod" THEN 'CARD_TERMINAL'::"PaymentChannel"
  WHEN "method" = 'TRANSFER'::"PaymentMethod" THEN 'BANK_ACCOUNT'::"PaymentChannel"
  WHEN "method" = 'MERCADO_PAGO'::"PaymentMethod" THEN 'VIRTUAL_WALLET'::"PaymentChannel"
  ELSE 'OTHER'::"PaymentChannel"
END
WHERE "channel" = 'AUTO'::"PaymentChannel";

-- CreateIndex
CREATE INDEX "Payment_channel_idx" ON "Payment"("channel");

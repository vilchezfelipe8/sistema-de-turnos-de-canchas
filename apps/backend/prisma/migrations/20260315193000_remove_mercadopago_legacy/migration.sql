-- Normalize legacy payment method values before enum replacement
UPDATE "Payment"
SET
  "method" = 'TRANSFER'::"PaymentMethod",
  "channel" = CASE
    WHEN COALESCE("channel", 'AUTO'::"PaymentChannel") = 'AUTO'::"PaymentChannel" THEN 'VIRTUAL_WALLET'::"PaymentChannel"
    ELSE "channel"
  END
WHERE "method" = 'MERCADO_PAGO'::"PaymentMethod";

-- Normalize legacy cash movement method values
UPDATE "CashMovement"
SET "method" = 'TRANSFER'::"CashMovementMethod"
WHERE "method" = 'MP'::"CashMovementMethod";

-- Normalize legacy refund execution values
UPDATE "Refund"
SET "executionMethod" = 'TRANSFER'::"RefundExecutionMethod"
WHERE "executionMethod" = 'MP_REFUND'::"RefundExecutionMethod";

-- Recreate PaymentMethod without MERCADO_PAGO
CREATE TYPE "PaymentMethod_new" AS ENUM ('CASH', 'TRANSFER', 'CARD', 'OTHER');
ALTER TABLE "Payment"
  ALTER COLUMN "method" TYPE "PaymentMethod_new"
  USING ("method"::text::"PaymentMethod_new");
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
ALTER TYPE "PaymentMethod_new" RENAME TO "PaymentMethod";
DROP TYPE "PaymentMethod_old";

-- Recreate CashMovementMethod without MP
CREATE TYPE "CashMovementMethod_new" AS ENUM ('CASH', 'TRANSFER', 'CARD');
ALTER TABLE "CashMovement"
  ALTER COLUMN "method" TYPE "CashMovementMethod_new"
  USING ("method"::text::"CashMovementMethod_new");
ALTER TYPE "CashMovementMethod" RENAME TO "CashMovementMethod_old";
ALTER TYPE "CashMovementMethod_new" RENAME TO "CashMovementMethod";
DROP TYPE "CashMovementMethod_old";

-- Recreate RefundExecutionMethod without MP_REFUND
CREATE TYPE "RefundExecutionMethod_new" AS ENUM ('CASH', 'TRANSFER', 'CARD_REVERSAL', 'CREDIT_NOTE', 'OTHER');
ALTER TABLE "Refund"
  ALTER COLUMN "executionMethod" TYPE "RefundExecutionMethod_new"
  USING ("executionMethod"::text::"RefundExecutionMethod_new");
ALTER TYPE "RefundExecutionMethod" RENAME TO "RefundExecutionMethod_old";
ALTER TYPE "RefundExecutionMethod_new" RENAME TO "RefundExecutionMethod";
DROP TYPE "RefundExecutionMethod_old";

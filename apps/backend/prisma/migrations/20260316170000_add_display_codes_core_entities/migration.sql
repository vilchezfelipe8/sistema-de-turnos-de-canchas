-- Display codes legibles para entidades operativas core

CREATE SEQUENCE IF NOT EXISTS "booking_display_code_seq";
CREATE SEQUENCE IF NOT EXISTS "account_display_code_seq";
CREATE SEQUENCE IF NOT EXISTS "payment_display_code_seq";
CREATE SEQUENCE IF NOT EXISTS "refund_display_code_seq";

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "displayCode" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "displayCode" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "displayCode" TEXT;
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "displayCode" TEXT;

UPDATE "Booking"
SET "displayCode" = ('RES-' || LPAD(nextval('booking_display_code_seq')::text, 6, '0'))
WHERE "displayCode" IS NULL;

UPDATE "Account"
SET "displayCode" = ('CTA-' || LPAD(nextval('account_display_code_seq')::text, 6, '0'))
WHERE "displayCode" IS NULL;

UPDATE "Payment"
SET "displayCode" = ('PAG-' || LPAD(nextval('payment_display_code_seq')::text, 6, '0'))
WHERE "displayCode" IS NULL;

UPDATE "Refund"
SET "displayCode" = ('DEV-' || LPAD(nextval('refund_display_code_seq')::text, 6, '0'))
WHERE "displayCode" IS NULL;

ALTER TABLE "Booking"
  ALTER COLUMN "displayCode" SET NOT NULL,
  ALTER COLUMN "displayCode" SET DEFAULT ('RES-' || LPAD(nextval('booking_display_code_seq')::text, 6, '0'));

ALTER TABLE "Account"
  ALTER COLUMN "displayCode" SET NOT NULL,
  ALTER COLUMN "displayCode" SET DEFAULT ('CTA-' || LPAD(nextval('account_display_code_seq')::text, 6, '0'));

ALTER TABLE "Payment"
  ALTER COLUMN "displayCode" SET NOT NULL,
  ALTER COLUMN "displayCode" SET DEFAULT ('PAG-' || LPAD(nextval('payment_display_code_seq')::text, 6, '0'));

ALTER TABLE "Refund"
  ALTER COLUMN "displayCode" SET NOT NULL,
  ALTER COLUMN "displayCode" SET DEFAULT ('DEV-' || LPAD(nextval('refund_display_code_seq')::text, 6, '0'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Booking_displayCode_key'
  ) THEN
    ALTER TABLE "Booking" ADD CONSTRAINT "Booking_displayCode_key" UNIQUE ("displayCode");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Account_displayCode_key'
  ) THEN
    ALTER TABLE "Account" ADD CONSTRAINT "Account_displayCode_key" UNIQUE ("displayCode");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Payment_displayCode_key'
  ) THEN
    ALTER TABLE "Payment" ADD CONSTRAINT "Payment_displayCode_key" UNIQUE ("displayCode");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Refund_displayCode_key'
  ) THEN
    ALTER TABLE "Refund" ADD CONSTRAINT "Refund_displayCode_key" UNIQUE ("displayCode");
  END IF;
END$$;

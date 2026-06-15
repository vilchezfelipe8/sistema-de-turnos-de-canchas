DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'ChargeMode'
  ) THEN
    CREATE TYPE "ChargeMode" AS ENUM ('INDIVIDUAL', 'SHARED');
  END IF;
END $$;

ALTER TABLE "Account"
  ALTER COLUMN "displayCode" DROP NOT NULL,
  ALTER COLUMN "displayCode" DROP DEFAULT;

ALTER TABLE "ActivityScheduleException"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Booking"
  ALTER COLUMN "displayCode" DROP NOT NULL,
  ALTER COLUMN "displayCode" DROP DEFAULT;

ALTER TABLE "ClubReview"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Payment"
  ALTER COLUMN "displayCode" DROP NOT NULL,
  ALTER COLUMN "displayCode" DROP DEFAULT;

ALTER TABLE "Refund"
  ALTER COLUMN "displayCode" DROP NOT NULL,
  ALTER COLUMN "displayCode" DROP DEFAULT;

CREATE TABLE IF NOT EXISTS "BookingBillingConfig" (
  "id" TEXT NOT NULL,
  "bookingId" INTEGER NOT NULL,
  "clubId" INTEGER NOT NULL,
  "chargeMode" "ChargeMode" NOT NULL,
  "chargeResponsibleRef" TEXT,
  "assignmentsJson" JSONB NOT NULL,
  "metadataJson" JSONB,
  "createdByUserId" INTEGER,
  "updatedByUserId" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "BookingBillingConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BookingBillingConfig_bookingId_key"
  ON "BookingBillingConfig"("bookingId");

CREATE INDEX IF NOT EXISTS "BookingBillingConfig_clubId_idx"
  ON "BookingBillingConfig"("clubId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'BookingBillingConfig_bookingId_fkey'
  ) THEN
    ALTER TABLE "BookingBillingConfig"
      ADD CONSTRAINT "BookingBillingConfig_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

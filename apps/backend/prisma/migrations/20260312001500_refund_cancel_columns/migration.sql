-- Add missing refund lifecycle cancellation columns for already-migrated databases
ALTER TABLE "Refund"
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "cancelledByUserId" INTEGER,
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Refund_cancelledByUserId_fkey'
  ) THEN
    ALTER TABLE "Refund"
      ADD CONSTRAINT "Refund_cancelledByUserId_fkey"
      FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Migration: add clientId to Account (P2-A)
-- Allows associating a Client to a BAR/POS account for visibility and reporting.

ALTER TABLE "Account"
  ADD COLUMN IF NOT EXISTS "clientId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Account_clientId_fkey'
  ) THEN
    ALTER TABLE "Account"
      ADD CONSTRAINT "Account_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Account_clientId_idx" ON "Account"("clientId");

-- Add DNI to Client and indexes to support deterministic identity resolution.
ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "dni" TEXT,
  ADD COLUMN IF NOT EXISTS "userId" INTEGER;

CREATE INDEX IF NOT EXISTS "Client_clubId_email_idx"
  ON "Client"("clubId", "email");

CREATE INDEX IF NOT EXISTS "Client_clubId_dni_idx"
  ON "Client"("clubId", "dni");

CREATE INDEX IF NOT EXISTS "Client_userId_idx"
  ON "Client"("userId");

-- Unique per club when dni is present. Postgres allows multiple NULL values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Client_clubId_dni_key'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relname = 'Client_clubId_dni_key'
  ) THEN
    ALTER TABLE "Client"
      ADD CONSTRAINT "Client_clubId_dni_key" UNIQUE ("clubId", "dni");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Client_clubId_userId_key'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relname = 'Client_clubId_userId_key'
  ) THEN
    ALTER TABLE "Client"
      ADD CONSTRAINT "Client_clubId_userId_key" UNIQUE ("clubId", "userId");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Client_userId_fkey'
  ) THEN
    ALTER TABLE "Client"
      ADD CONSTRAINT "Client_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

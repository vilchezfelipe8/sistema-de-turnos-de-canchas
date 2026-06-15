ALTER TYPE "BookingParticipantRole" ADD VALUE IF NOT EXISTS 'ORGANIZER';

ALTER TABLE "BookingParticipant"
  ADD COLUMN IF NOT EXISTS "clientId" TEXT,
  ADD COLUMN IF NOT EXISTS "displayName" TEXT,
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'BookingParticipant_clientId_fkey'
  ) THEN
    ALTER TABLE "BookingParticipant"
      ADD CONSTRAINT "BookingParticipant_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "BookingParticipant_bookingId_role_idx"
  ON "BookingParticipant"("bookingId", "role");

CREATE INDEX IF NOT EXISTS "BookingParticipant_clientId_idx"
  ON "BookingParticipant"("clientId");

-- Phase 2: Booking must always be client-centric
ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS "Booking_clientId_fkey";
ALTER TABLE "Booking" ALTER COLUMN "clientId" SET NOT NULL;
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- Phase 3: FixedBooking identity is client-centric
ALTER TABLE "FixedBooking" ADD COLUMN "clientId" TEXT;

-- Requiere base limpia o datos previamente saneados.
ALTER TABLE "FixedBooking" ALTER COLUMN "clientId" SET NOT NULL;

ALTER TABLE "FixedBooking"
  ADD CONSTRAINT "FixedBooking_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE INDEX "FixedBooking_clientId_idx" ON "FixedBooking"("clientId");

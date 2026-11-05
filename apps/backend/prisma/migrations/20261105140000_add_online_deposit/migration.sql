-- Seña online obligatoria: config del club y vencimiento por reserva hecha desde la app.
ALTER TABLE "ClubSettings" ADD COLUMN "onlineDepositRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClubSettings" ADD COLUMN "onlineDepositHoldMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "Booking" ADD COLUMN "onlineDepositDueAt" TIMESTAMPTZ(3);
CREATE INDEX "Booking_status_onlineDepositDueAt_idx" ON "Booking"("status", "onlineDepositDueAt");

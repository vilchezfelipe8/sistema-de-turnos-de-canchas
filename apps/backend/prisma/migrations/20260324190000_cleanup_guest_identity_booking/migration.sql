-- Phase 4: remove guest identity leftovers from booking domains
ALTER TABLE "Booking" DROP COLUMN IF EXISTS "guestIdentifier";

ALTER TABLE "FixedBooking" DROP COLUMN IF EXISTS "guestName";
ALTER TABLE "FixedBooking" DROP COLUMN IF EXISTS "guestPhone";
ALTER TABLE "FixedBooking" DROP COLUMN IF EXISTS "guestDni";

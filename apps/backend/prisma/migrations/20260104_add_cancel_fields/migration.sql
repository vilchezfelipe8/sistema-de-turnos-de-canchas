-- Migration: Añadir campos cancelledBy (int) y cancelledAt (timestamptz) a Booking
ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "cancelledBy" int,
ADD COLUMN IF NOT EXISTS "cancelledAt" timestamptz;


ALTER TABLE "Booking"
ADD COLUMN "listPrice" DECIMAL(10, 2) NOT NULL DEFAULT 0;

UPDATE "Booking"
SET "listPrice" = "price"
WHERE "listPrice" = 0;

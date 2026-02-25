-- Add openingDays JSONB to Club
ALTER TABLE "Club" ADD COLUMN IF NOT EXISTS "openingDays" JSONB;

-- Optionally initialize to empty array for existing records
-- UPDATE "Club" SET "openingDays" = '[]'::jsonb WHERE "openingDays" IS NULL;

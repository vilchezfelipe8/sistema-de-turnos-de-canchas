-- Add operational closure lifecycle fields to club settings
CREATE TYPE "ClubOperationalStatus" AS ENUM ('OPEN', 'TEMPORARY_CLOSED', 'PERMANENTLY_CLOSED');

ALTER TABLE "ClubSettings"
ADD COLUMN "clubOperationalStatus" "ClubOperationalStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN "temporaryClosureStartDate" DATE,
ADD COLUMN "temporaryClosureEndDate" DATE;

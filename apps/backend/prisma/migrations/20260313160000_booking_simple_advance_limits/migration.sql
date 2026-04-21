ALTER TABLE "ClubSettings"
ADD COLUMN "bookingSimpleAdvanceDaysUser" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "bookingSimpleAdvanceDaysAdmin" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "allowAdminSkipSimpleAdvanceLimit" BOOLEAN NOT NULL DEFAULT false;

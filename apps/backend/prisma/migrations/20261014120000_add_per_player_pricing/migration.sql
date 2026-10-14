-- CreateEnum
CREATE TYPE "ClubPricingMode" AS ENUM ('PER_COURT', 'PER_PLAYER');

-- CreateEnum
CREATE TYPE "MemberPriceValidation" AS ENUM ('NOT_MEMBER', 'SELF', 'ACCEPTED', 'STAFF_VALIDATED', 'PENDING');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "activityFormatId" TEXT,
ADD COLUMN     "memberBenefitAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "playerCount" INTEGER;

-- AlterTable
ALTER TABLE "FixedBooking" ADD COLUMN     "activityFormatId" TEXT;

-- AlterTable
ALTER TABLE "AccountItem" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "ClubSettings" ADD COLUMN     "pricingMode" "ClubPricingMode" NOT NULL DEFAULT 'PER_COURT';

-- CreateTable
CREATE TABLE "ActivityFormat" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "activityTypeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "playerCount" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ActivityFormat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerPriceRule" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "activityFormatId" TEXT NOT NULL,
    "memberCategoryId" TEXT,
    "pricePerPlayer" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PlayerPriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingPlayerSlot" (
    "id" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "clubId" INTEGER NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "participantId" TEXT,
    "clientId" TEXT,
    "userId" INTEGER,
    "displayName" TEXT,
    "pricingMemberCategoryId" TEXT,
    "memberPriceValidation" "MemberPriceValidation" NOT NULL DEFAULT 'NOT_MEMBER',
    "memberValidatedByUserId" INTEGER,
    "shareListAmount" DECIMAL(10,2) NOT NULL,
    "shareAmount" DECIMAL(10,2) NOT NULL,
    "sharePricedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountItemId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BookingPlayerSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityFormat_clubId_isActive_idx" ON "ActivityFormat"("clubId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityFormat_activityTypeId_name_key" ON "ActivityFormat"("activityTypeId", "name");

-- CreateIndex
CREATE INDEX "PlayerPriceRule_activityFormatId_memberCategoryId_idx" ON "PlayerPriceRule"("activityFormatId", "memberCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingPlayerSlot_participantId_key" ON "BookingPlayerSlot"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingPlayerSlot_accountItemId_key" ON "BookingPlayerSlot"("accountItemId");

-- CreateIndex
CREATE INDEX "BookingPlayerSlot_clubId_clientId_idx" ON "BookingPlayerSlot"("clubId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingPlayerSlot_bookingId_slotIndex_key" ON "BookingPlayerSlot"("bookingId", "slotIndex");

-- AddForeignKey
ALTER TABLE "ActivityFormat" ADD CONSTRAINT "ActivityFormat_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerPriceRule" ADD CONSTRAINT "PlayerPriceRule_activityFormatId_fkey" FOREIGN KEY ("activityFormatId") REFERENCES "ActivityFormat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerPriceRule" ADD CONSTRAINT "PlayerPriceRule_memberCategoryId_fkey" FOREIGN KEY ("memberCategoryId") REFERENCES "MemberCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_activityFormatId_fkey" FOREIGN KEY ("activityFormatId") REFERENCES "ActivityFormat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedBooking" ADD CONSTRAINT "FixedBooking_activityFormatId_fkey" FOREIGN KEY ("activityFormatId") REFERENCES "ActivityFormat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingPlayerSlot" ADD CONSTRAINT "BookingPlayerSlot_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingPlayerSlot" ADD CONSTRAINT "BookingPlayerSlot_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "BookingParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingPlayerSlot" ADD CONSTRAINT "BookingPlayerSlot_accountItemId_fkey" FOREIGN KEY ("accountItemId") REFERENCES "AccountItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Invitación por DNI (usuario sin email)
ALTER TABLE "BookingParticipant" ADD COLUMN "invitedUserId" INTEGER;
CREATE INDEX "BookingParticipant_invitedUserId_status_idx" ON "BookingParticipant"("invitedUserId", "status");

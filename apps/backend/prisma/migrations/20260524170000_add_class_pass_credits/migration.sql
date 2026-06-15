-- CreateEnum
CREATE TYPE "ClassPassStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DEPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClassCreditUsageReason" AS ENUM ('ATTENDANCE', 'LATE_CANCEL', 'NO_SHOW', 'MANUAL_ADJUSTMENT', 'REFUND_REVERSAL');

-- DropForeignKey
ALTER TABLE "ActivityScheduleException" DROP CONSTRAINT "ActivityScheduleException_activityTypeId_fkey";

-- CreateTable
CREATE TABLE "ClassPass" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "ownerClientId" TEXT NOT NULL,
    "ownerUserId" INTEGER,
    "beneficiaryClientId" TEXT NOT NULL,
    "beneficiaryUserId" INTEGER,
    "packageName" TEXT NOT NULL,
    "totalCredits" INTEGER NOT NULL,
    "usedCredits" INTEGER NOT NULL DEFAULT 0,
    "remainingCredits" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "activityTypeId" INTEGER,
    "classType" "ClassSessionType",
    "teacherId" TEXT,
    "transferable" BOOLEAN NOT NULL DEFAULT false,
    "status" "ClassPassStatus" NOT NULL DEFAULT 'ACTIVE',
    "purchasedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassPass_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ClassPass"
  ADD CONSTRAINT "ClassPass_totalCredits_positive_check" CHECK ("totalCredits" > 0),
  ADD CONSTRAINT "ClassPass_usedCredits_nonnegative_check" CHECK ("usedCredits" >= 0),
  ADD CONSTRAINT "ClassPass_remainingCredits_nonnegative_check" CHECK ("remainingCredits" >= 0),
  ADD CONSTRAINT "ClassPass_credit_balance_check" CHECK ("usedCredits" + "remainingCredits" = "totalCredits");

-- CreateTable
CREATE TABLE "ClassCreditUsage" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "classPassId" TEXT NOT NULL,
    "classEnrollmentId" TEXT NOT NULL,
    "creditsUsed" INTEGER NOT NULL,
    "usedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" "ClassCreditUsageReason" NOT NULL,
    "notes" TEXT,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassCreditUsage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ClassCreditUsage"
  ADD CONSTRAINT "ClassCreditUsage_creditsUsed_positive_check" CHECK ("creditsUsed" > 0);

-- CreateIndex
CREATE INDEX "ClassPass_clubId_status_idx" ON "ClassPass"("clubId", "status");

-- CreateIndex
CREATE INDEX "ClassPass_clubId_ownerClientId_idx" ON "ClassPass"("clubId", "ownerClientId");

-- CreateIndex
CREATE INDEX "ClassPass_clubId_beneficiaryClientId_idx" ON "ClassPass"("clubId", "beneficiaryClientId");

-- CreateIndex
CREATE INDEX "ClassPass_clubId_expiresAt_idx" ON "ClassPass"("clubId", "expiresAt");

-- CreateIndex
CREATE INDEX "ClassPass_clubId_activityTypeId_idx" ON "ClassPass"("clubId", "activityTypeId");

-- CreateIndex
CREATE INDEX "ClassPass_clubId_teacherId_idx" ON "ClassPass"("clubId", "teacherId");

-- CreateIndex
CREATE INDEX "ClassPass_beneficiaryClientId_status_expiresAt_idx" ON "ClassPass"("beneficiaryClientId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "ClassCreditUsage_clubId_classPassId_usedAt_idx" ON "ClassCreditUsage"("clubId", "classPassId", "usedAt");

-- CreateIndex
CREATE INDEX "ClassCreditUsage_clubId_classEnrollmentId_usedAt_idx" ON "ClassCreditUsage"("clubId", "classEnrollmentId", "usedAt");

-- CreateIndex
CREATE INDEX "ClassCreditUsage_clubId_reason_usedAt_idx" ON "ClassCreditUsage"("clubId", "reason", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClassCreditUsage_classPassId_classEnrollmentId_key" ON "ClassCreditUsage"("classPassId", "classEnrollmentId");

-- AddForeignKey
ALTER TABLE "ActivityScheduleException" ADD CONSTRAINT "ActivityScheduleException_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassPass" ADD CONSTRAINT "ClassPass_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassPass" ADD CONSTRAINT "ClassPass_ownerClientId_fkey" FOREIGN KEY ("ownerClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassPass" ADD CONSTRAINT "ClassPass_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassPass" ADD CONSTRAINT "ClassPass_beneficiaryClientId_fkey" FOREIGN KEY ("beneficiaryClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassPass" ADD CONSTRAINT "ClassPass_beneficiaryUserId_fkey" FOREIGN KEY ("beneficiaryUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassPass" ADD CONSTRAINT "ClassPass_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassPass" ADD CONSTRAINT "ClassPass_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassPass" ADD CONSTRAINT "ClassPass_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassCreditUsage" ADD CONSTRAINT "ClassCreditUsage_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassCreditUsage" ADD CONSTRAINT "ClassCreditUsage_classPassId_fkey" FOREIGN KEY ("classPassId") REFERENCES "ClassPass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassCreditUsage" ADD CONSTRAINT "ClassCreditUsage_classEnrollmentId_fkey" FOREIGN KEY ("classEnrollmentId") REFERENCES "ClassEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassCreditUsage" ADD CONSTRAINT "ClassCreditUsage_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

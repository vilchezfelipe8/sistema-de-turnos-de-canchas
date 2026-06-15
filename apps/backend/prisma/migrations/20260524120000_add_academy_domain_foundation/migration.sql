-- CreateEnum
CREATE TYPE "ClientRelationshipType" AS ENUM ('PARENT', 'GUARDIAN', 'CHILD', 'PAYER', 'FAMILY_MEMBER', 'EMERGENCY_CONTACT', 'OTHER');

-- CreateEnum
CREATE TYPE "ClassSessionVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ClassSessionType" AS ENUM ('INDIVIDUAL', 'GROUP');

-- CreateEnum
CREATE TYPE "ClassSessionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClassEnrollmentStatus" AS ENUM ('ENROLLED', 'WAITLISTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClassAttendanceStatus" AS ENUM ('PENDING', 'ATTENDED', 'ABSENT', 'NO_SHOW', 'CANCELLED_ON_TIME', 'CANCELLED_LATE');

-- CreateEnum
CREATE TYPE "ClassEnrollmentPaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'COVERED_BY_CREDIT', 'REFUNDED');

-- CreateTable
CREATE TABLE "ClientRelationship" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "fromClientId" TEXT NOT NULL,
    "toClientId" TEXT NOT NULL,
    "relationshipType" "ClientRelationshipType" NOT NULL,
    "canPayFor" BOOLEAN NOT NULL DEFAULT false,
    "canManageEnrollments" BOOLEAN NOT NULL DEFAULT false,
    "canViewSchedule" BOOLEAN NOT NULL DEFAULT false,
    "canCancelClass" BOOLEAN NOT NULL DEFAULT false,
    "canViewPayments" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClientRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassSession" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "teacherId" TEXT NOT NULL,
    "visibility" "ClassSessionVisibility" NOT NULL,
    "classType" "ClassSessionType" NOT NULL,
    "activityTypeId" INTEGER,
    "courtId" INTEGER,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "pricePerStudent" DECIMAL(10,2),
    "status" "ClassSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "level" TEXT,
    "description" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "requiresPaymentToEnroll" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" INTEGER NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassEnrollment" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "classSessionId" TEXT NOT NULL,
    "studentClientId" TEXT NOT NULL,
    "studentUserId" INTEGER,
    "billingResponsibleClientId" TEXT,
    "snapshotName" TEXT NOT NULL,
    "snapshotEmail" TEXT,
    "snapshotPhone" TEXT,
    "priceAtEnrollment" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "enrollmentStatus" "ClassEnrollmentStatus" NOT NULL DEFAULT 'ENROLLED',
    "attendanceStatus" "ClassAttendanceStatus" NOT NULL DEFAULT 'PENDING',
    "paymentStatus" "ClassEnrollmentPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "cancelledAt" TIMESTAMPTZ(3),
    "attendedAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientRelationship_clubId_fromClientId_idx" ON "ClientRelationship"("clubId", "fromClientId");

-- CreateIndex
CREATE INDEX "ClientRelationship_clubId_toClientId_idx" ON "ClientRelationship"("clubId", "toClientId");

-- CreateIndex
CREATE INDEX "ClientRelationship_clubId_relationshipType_idx" ON "ClientRelationship"("clubId", "relationshipType");

-- CreateIndex
CREATE UNIQUE INDEX "ClientRelationship_clubId_fromClientId_toClientId_relations_key" ON "ClientRelationship"("clubId", "fromClientId", "toClientId", "relationshipType");

-- CreateIndex
CREATE INDEX "ClassSession_clubId_startsAt_idx" ON "ClassSession"("clubId", "startsAt");

-- CreateIndex
CREATE INDEX "ClassSession_clubId_status_idx" ON "ClassSession"("clubId", "status");

-- CreateIndex
CREATE INDEX "ClassSession_clubId_teacherId_startsAt_idx" ON "ClassSession"("clubId", "teacherId", "startsAt");

-- CreateIndex
CREATE INDEX "ClassSession_clubId_courtId_startsAt_idx" ON "ClassSession"("clubId", "courtId", "startsAt");

-- CreateIndex
CREATE INDEX "ClassSession_clubId_visibility_classType_idx" ON "ClassSession"("clubId", "visibility", "classType");

-- CreateIndex
CREATE INDEX "ClassEnrollment_clubId_classSessionId_idx" ON "ClassEnrollment"("clubId", "classSessionId");

-- CreateIndex
CREATE INDEX "ClassEnrollment_clubId_studentClientId_idx" ON "ClassEnrollment"("clubId", "studentClientId");

-- CreateIndex
CREATE INDEX "ClassEnrollment_clubId_billingResponsibleClientId_idx" ON "ClassEnrollment"("clubId", "billingResponsibleClientId");

-- CreateIndex
CREATE INDEX "ClassEnrollment_classSessionId_enrollmentStatus_idx" ON "ClassEnrollment"("classSessionId", "enrollmentStatus");

-- CreateIndex
CREATE INDEX "ClassEnrollment_classSessionId_attendanceStatus_idx" ON "ClassEnrollment"("classSessionId", "attendanceStatus");

-- CreateIndex
CREATE INDEX "ClassEnrollment_classSessionId_paymentStatus_idx" ON "ClassEnrollment"("classSessionId", "paymentStatus");

-- AddForeignKey
ALTER TABLE "ClientRelationship" ADD CONSTRAINT "ClientRelationship_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRelationship" ADD CONSTRAINT "ClientRelationship_fromClientId_fkey" FOREIGN KEY ("fromClientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRelationship" ADD CONSTRAINT "ClientRelationship_toClientId_fkey" FOREIGN KEY ("toClientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassEnrollment" ADD CONSTRAINT "ClassEnrollment_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassEnrollment" ADD CONSTRAINT "ClassEnrollment_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "ClassSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassEnrollment" ADD CONSTRAINT "ClassEnrollment_studentClientId_fkey" FOREIGN KEY ("studentClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassEnrollment" ADD CONSTRAINT "ClassEnrollment_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassEnrollment" ADD CONSTRAINT "ClassEnrollment_billingResponsibleClientId_fkey" FOREIGN KEY ("billingResponsibleClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassEnrollment" ADD CONSTRAINT "ClassEnrollment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


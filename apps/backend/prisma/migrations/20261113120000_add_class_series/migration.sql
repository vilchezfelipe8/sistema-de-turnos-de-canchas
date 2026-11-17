-- CreateEnum
CREATE TYPE "ClassSeriesStatus" AS ENUM ('ACTIVE', 'ENDED');

-- AlterTable
ALTER TABLE "ClassSession" ADD COLUMN     "seriesId" TEXT;

-- AlterTable
ALTER TABLE "ClassEnrollment" ADD COLUMN     "seriesMemberId" TEXT;

-- CreateTable
CREATE TABLE "ClassSeries" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "teacherId" TEXT NOT NULL,
    "activityTypeId" INTEGER,
    "courtId" INTEGER,
    "classType" "ClassSessionType" NOT NULL,
    "weekdays" INTEGER[],
    "startTime" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "pricePerStudent" DECIMAL(10,2),
    "level" TEXT,
    "description" TEXT,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "generatedUntil" DATE,
    "status" "ClassSeriesStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassSeriesMember" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "seriesId" TEXT NOT NULL,
    "studentClientId" TEXT NOT NULL,
    "billingResponsibleClientId" TEXT,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassSeriesMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassSeries_clubId_status_idx" ON "ClassSeries"("clubId", "status");

-- CreateIndex
CREATE INDEX "ClassSeries_teacherId_idx" ON "ClassSeries"("teacherId");

-- CreateIndex
CREATE INDEX "ClassSeriesMember_seriesId_leftAt_idx" ON "ClassSeriesMember"("seriesId", "leftAt");

-- CreateIndex
CREATE INDEX "ClassSeriesMember_clubId_studentClientId_idx" ON "ClassSeriesMember"("clubId", "studentClientId");

-- CreateIndex
CREATE INDEX "ClassSession_seriesId_startsAt_idx" ON "ClassSession"("seriesId", "startsAt");

-- CreateIndex
CREATE INDEX "ClassEnrollment_seriesMemberId_idx" ON "ClassEnrollment"("seriesMemberId");

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "ClassSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassEnrollment" ADD CONSTRAINT "ClassEnrollment_seriesMemberId_fkey" FOREIGN KEY ("seriesMemberId") REFERENCES "ClassSeriesMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSeries" ADD CONSTRAINT "ClassSeries_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSeries" ADD CONSTRAINT "ClassSeries_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSeries" ADD CONSTRAINT "ClassSeries_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSeries" ADD CONSTRAINT "ClassSeries_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSeriesMember" ADD CONSTRAINT "ClassSeriesMember_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSeriesMember" ADD CONSTRAINT "ClassSeriesMember_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "ClassSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSeriesMember" ADD CONSTRAINT "ClassSeriesMember_studentClientId_fkey" FOREIGN KEY ("studentClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSeriesMember" ADD CONSTRAINT "ClassSeriesMember_billingResponsibleClientId_fkey" FOREIGN KEY ("billingResponsibleClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;


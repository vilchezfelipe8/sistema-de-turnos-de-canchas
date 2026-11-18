-- CreateEnum
CREATE TYPE "ActivityTurnStatus" AS ENUM ('BOOKED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ActivityTurnSchedule" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "activityTypeId" INTEGER NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 60,
    "capacity" INTEGER NOT NULL,
    "windows" JSONB NOT NULL,
    "bookAheadDays" INTEGER NOT NULL DEFAULT 7,
    "requiresTurn" BOOLEAN NOT NULL DEFAULT true,
    "earlyEntryMinutes" INTEGER NOT NULL DEFAULT 15,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ActivityTurnSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityTurn" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "activityTypeId" INTEGER NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" INTEGER,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ActivityTurnStatus" NOT NULL DEFAULT 'BOOKED',
    "checkedInAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ActivityTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActivityTurnSchedule_activityTypeId_key" ON "ActivityTurnSchedule"("activityTypeId");

-- CreateIndex
CREATE INDEX "ActivityTurnSchedule_clubId_isActive_idx" ON "ActivityTurnSchedule"("clubId", "isActive");

-- CreateIndex
CREATE INDEX "ActivityTurn_activityTypeId_startsAt_status_idx" ON "ActivityTurn"("activityTypeId", "startsAt", "status");

-- CreateIndex
CREATE INDEX "ActivityTurn_clubId_clientId_startsAt_idx" ON "ActivityTurn"("clubId", "clientId", "startsAt");

-- AddForeignKey
ALTER TABLE "ActivityTurnSchedule" ADD CONSTRAINT "ActivityTurnSchedule_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityTurnSchedule" ADD CONSTRAINT "ActivityTurnSchedule_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityTurn" ADD CONSTRAINT "ActivityTurn_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityTurn" ADD CONSTRAINT "ActivityTurn_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityTurn" ADD CONSTRAINT "ActivityTurn_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityTurn" ADD CONSTRAINT "ActivityTurn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


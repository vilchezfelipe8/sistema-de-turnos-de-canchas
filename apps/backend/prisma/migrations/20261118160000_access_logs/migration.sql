-- CreateEnum
CREATE TYPE "AccessLogResult" AS ENUM ('ALLOWED', 'DENIED');

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "activityTypeId" INTEGER,
    "clientId" TEXT,
    "method" TEXT NOT NULL,
    "result" "AccessLogResult" NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "turnId" TEXT,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessLog_clubId_createdAt_idx" ON "AccessLog"("clubId", "createdAt");

-- CreateIndex
CREATE INDEX "AccessLog_clientId_createdAt_idx" ON "AccessLog"("clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;


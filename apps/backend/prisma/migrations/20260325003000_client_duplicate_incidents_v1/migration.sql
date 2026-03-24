-- CreateEnum
CREATE TYPE "ClientDuplicateIncidentStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "ClientDuplicateIncident" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "userId" INTEGER,
    "status" "ClientDuplicateIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "reasonType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "primaryClientId" TEXT,
    "candidateClientIds" JSONB NOT NULL,
    "payload" JSONB,
    "resolutionType" TEXT,
    "resolutionNotes" TEXT,
    "resolvedClientId" TEXT,
    "resolvedByUserId" INTEGER,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClientDuplicateIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientDuplicateIncident_clubId_status_createdAt_idx" ON "ClientDuplicateIncident"("clubId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ClientDuplicateIncident_clubId_dedupeKey_status_idx" ON "ClientDuplicateIncident"("clubId", "dedupeKey", "status");

-- AddForeignKey
ALTER TABLE "ClientDuplicateIncident"
ADD CONSTRAINT "ClientDuplicateIncident_clubId_fkey"
FOREIGN KEY ("clubId") REFERENCES "Club"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDuplicateIncident"
ADD CONSTRAINT "ClientDuplicateIncident_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDuplicateIncident"
ADD CONSTRAINT "ClientDuplicateIncident_primaryClientId_fkey"
FOREIGN KEY ("primaryClientId") REFERENCES "Client"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDuplicateIncident"
ADD CONSTRAINT "ClientDuplicateIncident_resolvedClientId_fkey"
FOREIGN KEY ("resolvedClientId") REFERENCES "Client"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDuplicateIncident"
ADD CONSTRAINT "ClientDuplicateIncident_resolvedByUserId_fkey"
FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

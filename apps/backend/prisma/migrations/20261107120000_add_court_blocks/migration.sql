-- Bloqueos de cancha: franjas no reservables (mantenimiento, eventos, etc.).
CREATE TABLE "CourtBlock" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "courtId" INTEGER NOT NULL,
    "startDateTime" TIMESTAMPTZ(3) NOT NULL,
    "endDateTime" TIMESTAMPTZ(3) NOT NULL,
    "title" TEXT,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CourtBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CourtBlock_clubId_startDateTime_idx" ON "CourtBlock"("clubId", "startDateTime");
CREATE INDEX "CourtBlock_courtId_startDateTime_endDateTime_idx" ON "CourtBlock"("courtId", "startDateTime", "endDateTime");

ALTER TABLE "CourtBlock" ADD CONSTRAINT "CourtBlock_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourtBlock" ADD CONSTRAINT "CourtBlock_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE CASCADE ON UPDATE CASCADE;

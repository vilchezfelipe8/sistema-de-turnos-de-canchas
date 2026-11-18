-- CreateTable
CREATE TABLE "ClientFingerprint" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "clientId" TEXT NOT NULL,
    "finger" INTEGER,
    "format" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "consentAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientFingerprint_clubId_idx" ON "ClientFingerprint"("clubId");

-- CreateIndex
CREATE INDEX "ClientFingerprint_clientId_idx" ON "ClientFingerprint"("clientId");

-- AddForeignKey
ALTER TABLE "ClientFingerprint" ADD CONSTRAINT "ClientFingerprint_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFingerprint" ADD CONSTRAINT "ClientFingerprint_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;


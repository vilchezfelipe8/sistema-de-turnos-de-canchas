-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL,
    "clubId" INTEGER NOT NULL,
    "clientId" TEXT,
    "userId" INTEGER,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "specialtiesJson" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Teacher_clubId_isActive_displayName_idx" ON "Teacher"("clubId", "isActive", "displayName");

-- CreateIndex
CREATE INDEX "Teacher_clientId_idx" ON "Teacher"("clientId");

-- CreateIndex
CREATE INDEX "Teacher_userId_idx" ON "Teacher"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_clubId_clientId_key" ON "Teacher"("clubId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_clubId_userId_key" ON "Teacher"("clubId", "userId");

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

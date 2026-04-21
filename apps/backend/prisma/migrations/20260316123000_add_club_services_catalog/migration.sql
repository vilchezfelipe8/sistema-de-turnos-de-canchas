-- CreateTable
CREATE TABLE "ClubServiceCatalog" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "clubId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClubServiceCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClubServiceCatalog_clubId_code_key" ON "ClubServiceCatalog"("clubId", "code");

-- CreateIndex
CREATE INDEX "ClubServiceCatalog_clubId_isActive_idx" ON "ClubServiceCatalog"("clubId", "isActive");

-- AddForeignKey
ALTER TABLE "ClubServiceCatalog" ADD CONSTRAINT "ClubServiceCatalog_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

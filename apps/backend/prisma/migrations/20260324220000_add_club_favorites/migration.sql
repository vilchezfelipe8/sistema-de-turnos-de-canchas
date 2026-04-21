CREATE TABLE "ClubFavorite" (
  "id" TEXT NOT NULL,
  "clubId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubFavorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClubFavorite_clubId_userId_key" ON "ClubFavorite"("clubId", "userId");
CREATE INDEX "ClubFavorite_userId_createdAt_idx" ON "ClubFavorite"("userId", "createdAt");

ALTER TABLE "ClubFavorite"
ADD CONSTRAINT "ClubFavorite_clubId_fkey"
FOREIGN KEY ("clubId") REFERENCES "Club"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClubFavorite"
ADD CONSTRAINT "ClubFavorite_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

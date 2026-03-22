CREATE TYPE "ClubReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN');

CREATE TABLE "ClubReview" (
  "id" TEXT NOT NULL,
  "clubId" INTEGER NOT NULL,
  "bookingId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "status" "ClubReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),

  CONSTRAINT "ClubReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClubReview_rating_range_check" CHECK ("rating" >= 1 AND "rating" <= 5),
  CONSTRAINT "ClubReview_clubId_fkey"
    FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClubReview_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClubReview_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ClubReview_bookingId_userId_key"
  ON "ClubReview"("bookingId", "userId");

CREATE INDEX "ClubReview_clubId_status_createdAt_idx"
  ON "ClubReview"("clubId", "status", "createdAt");

CREATE INDEX "ClubReview_userId_createdAt_idx"
  ON "ClubReview"("userId", "createdAt");

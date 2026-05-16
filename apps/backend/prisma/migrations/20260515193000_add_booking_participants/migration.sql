CREATE TYPE "BookingParticipantStatus" AS ENUM ('INVITED', 'JOINED', 'DECLINED', 'LEFT', 'REMOVED');
CREATE TYPE "BookingParticipantRole" AS ENUM ('PARTICIPANT');

CREATE TABLE "BookingParticipant" (
    "id" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "userId" INTEGER,
    "invitedEmail" TEXT,
    "invitedName" TEXT,
    "status" "BookingParticipantStatus" NOT NULL DEFAULT 'INVITED',
    "role" "BookingParticipantRole" NOT NULL DEFAULT 'PARTICIPANT',
    "invitedByUserId" INTEGER,
    "acceptedAt" TIMESTAMPTZ(3),
    "declinedAt" TIMESTAMPTZ(3),
    "leftAt" TIMESTAMPTZ(3),
    "removedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BookingParticipant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingParticipant_bookingId_userId_key"
  ON "BookingParticipant"("bookingId", "userId");
CREATE INDEX "BookingParticipant_bookingId_status_idx"
  ON "BookingParticipant"("bookingId", "status");
CREATE INDEX "BookingParticipant_userId_status_idx"
  ON "BookingParticipant"("userId", "status");
CREATE INDEX "BookingParticipant_invitedEmail_status_idx"
  ON "BookingParticipant"("invitedEmail", "status");

ALTER TABLE "BookingParticipant"
  ADD CONSTRAINT "BookingParticipant_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingParticipant"
  ADD CONSTRAINT "BookingParticipant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BookingParticipant"
  ADD CONSTRAINT "BookingParticipant_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

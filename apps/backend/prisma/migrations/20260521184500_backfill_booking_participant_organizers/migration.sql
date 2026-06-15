CREATE UNIQUE INDEX IF NOT EXISTS "booking_participant_one_organizer_per_booking"
  ON "BookingParticipant" ("bookingId")
  WHERE "role" = 'ORGANIZER';

INSERT INTO "BookingParticipant" (
  "id",
  "bookingId",
  "clientId",
  "userId",
  "displayName",
  "email",
  "phone",
  "status",
  "role",
  "acceptedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'org-booking-' || b."id"::text,
  b."id",
  b."clientId",
  b."userId",
  c."name",
  c."email",
  c."phone",
  'JOINED'::"BookingParticipantStatus",
  'ORGANIZER'::"BookingParticipantRole",
  b."createdAt",
  b."createdAt",
  b."createdAt"
FROM "Booking" b
JOIN "Client" c
  ON c."id" = b."clientId"
WHERE NOT EXISTS (
  SELECT 1
  FROM "BookingParticipant" bp
  WHERE bp."bookingId" = b."id"
    AND bp."role" = 'ORGANIZER'
);

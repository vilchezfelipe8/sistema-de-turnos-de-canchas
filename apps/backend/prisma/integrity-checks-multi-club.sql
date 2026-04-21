-- Verificación de integridad multi-club

-- 1) Bookings sin clubId
SELECT COUNT(*) AS bookings_without_club
FROM "Booking"
WHERE "clubId" IS NULL;

-- 2) ActivityType sin clubId
SELECT COUNT(*) AS activity_types_without_club
FROM "ActivityType"
WHERE "clubId" IS NULL;

-- 3) Courts sin clubId
SELECT COUNT(*) AS courts_without_club
FROM "Court"
WHERE "clubId" IS NULL;

-- 4) FixedBookings sin clubId
SELECT COUNT(*) AS fixed_bookings_without_club
FROM "FixedBooking"
WHERE "clubId" IS NULL;

-- 5) Memberships inválidas (usuario/club inexistente)
SELECT COUNT(*) AS memberships_with_missing_user
FROM "Membership" m
LEFT JOIN "User" u ON u."id" = m."userId"
WHERE u."id" IS NULL;

SELECT COUNT(*) AS memberships_with_missing_club
FROM "Membership" m
LEFT JOIN "Club" c ON c."id" = m."clubId"
WHERE c."id" IS NULL;

-- 6) Consistencia Booking vs Court en club
SELECT COUNT(*) AS bookings_with_mismatched_club
FROM "Booking" b
JOIN "Court" c ON c."id" = b."courtId"
WHERE b."clubId" <> c."clubId";

-- 7) Consistencia FixedBooking vs Court en club
SELECT COUNT(*) AS fixed_bookings_with_mismatched_club
FROM "FixedBooking" fb
JOIN "Court" c ON c."id" = fb."courtId"
WHERE fb."clubId" <> c."clubId";

-- 8) Índices esperados
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'booking_club_day',
    'booking_court_day',
    'booking_activity_day'
  )
ORDER BY indexname;

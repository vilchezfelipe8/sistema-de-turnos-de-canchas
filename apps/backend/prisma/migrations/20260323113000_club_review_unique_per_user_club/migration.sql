-- Enfoque pre-release: no preservamos historial duplicado por club/usuario.
-- Si existen duplicados históricos, conservamos la reseña más reciente por (clubId, userId).
WITH ranked AS (
  SELECT
    id,
    "clubId",
    "userId",
    ROW_NUMBER() OVER (
      PARTITION BY "clubId", "userId"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
    ) AS rn
  FROM "ClubReview"
)
DELETE FROM "ClubReview" r
USING ranked d
WHERE r.id = d.id
  AND d.rn > 1;

DROP INDEX IF EXISTS "ClubReview_bookingId_userId_key";
CREATE UNIQUE INDEX "ClubReview_clubId_userId_key" ON "ClubReview"("clubId", "userId");

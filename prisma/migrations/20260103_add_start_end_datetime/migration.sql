-- Migration: Añadir columnas startDateTime y endDateTime (timestamptz) y poblar desde date + startTime/endTime
-- Fecha: 2026-01-03

-- 1) Añadir columnas nuevas (nullable para permitir migración gradual)
ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "startDateTime" timestamptz,
ADD COLUMN IF NOT EXISTS "endDateTime" timestamptz;

-- 2) Poblar las columnas nuevas a partir de los valores existentes.
-- Se asume que "date" contiene el día (timestamp al inicio del día) y que
-- startTime/endTime están en formato 'HH:MM'.
UPDATE "Booking"
SET
  "startDateTime" = date + (startTime || ':00')::interval,
  "endDateTime"   = date + (endTime   || ':00')::interval
WHERE ("startDateTime" IS NULL OR "endDateTime" IS NULL)
  AND (startTime IS NOT NULL AND endTime IS NOT NULL);

-- 3) Opcional: comprobar filas sin valores válidos para revisión manual
-- SELECT id FROM "Booking" WHERE "startDateTime" IS NULL OR "endDateTime" IS NULL;

-- Nota: Esta migración no elimina las columnas antiguas ni establece NOT NULL.
-- Pasos posteriores recomendados (otro migration):
--  - Verificar integridad y resolver filas problemáticas.
--  - Establecer NOT NULL en las nuevas columnas.
--  - Actualizar código para usar startDateTime/endDateTime.
--  - (Opcional) eliminar columnas antiguas startTime/endTime/date si ya no son necesarias.


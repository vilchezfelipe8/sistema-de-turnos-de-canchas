-- Migration: Add exclusion constraint to prevent overlapping bookings per court
-- Date: 2026-01-02

-- Ensure the btree_gist extension (required for GIST indexes on ints + ranges)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Add an exclusion constraint that prevents two bookings for the same court
-- from having overlapping time ranges on the same day.
-- We build a tstzrange from the stored `date` (assumed to be midnight of the day)
-- plus the `startTime` / `endTime` string (format "HH:MM"), cast to interval.
--
-- NOTE: this migration assumes `Booking.date` is stored as a timestamp at
-- the beginning of the day (00:00) and that `startTime`/`endTime` are strings
-- with "HH:MM" 24-hour format.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'booking_no_overlap'
  ) THEN
    ALTER TABLE "Booking"
    ADD CONSTRAINT booking_no_overlap
    EXCLUDE USING GIST (
      "courtId" WITH =,
      ( tstzrange(
          date + (startTime || ':00')::interval,
          date + (endTime || ':00')::interval
        )
      ) WITH &&
    )
    WHERE (status <> 'CANCELLED');
  END IF;
END;
$$;


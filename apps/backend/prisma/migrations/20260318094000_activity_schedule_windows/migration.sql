-- Optional split ranges per activity schedule (e.g. 08:00-12:00 and 16:00-23:00)
ALTER TABLE "ActivityType"
ADD COLUMN "scheduleWindows" JSONB;

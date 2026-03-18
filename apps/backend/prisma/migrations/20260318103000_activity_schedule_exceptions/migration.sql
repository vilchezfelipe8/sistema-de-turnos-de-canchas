-- Per-date schedule overrides for each activity
CREATE TABLE "ActivityScheduleException" (
  "id" SERIAL PRIMARY KEY,
  "activityTypeId" INTEGER NOT NULL,
  "localDate" DATE NOT NULL,
  "isClosed" BOOLEAN NOT NULL DEFAULT false,
  "scheduleMode" "ScheduleMode",
  "scheduleOpenTime" TEXT,
  "scheduleCloseTime" TEXT,
  "scheduleIntervalMinutes" INTEGER,
  "scheduleWindows" JSONB,
  "scheduleDurations" JSONB,
  "scheduleFixedSlots" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "ActivityScheduleException_activityTypeId_fkey"
    FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "ActivityScheduleException_activityTypeId_localDate_key"
  ON "ActivityScheduleException"("activityTypeId", "localDate");

CREATE INDEX "ActivityScheduleException_localDate_idx"
  ON "ActivityScheduleException"("localDate");

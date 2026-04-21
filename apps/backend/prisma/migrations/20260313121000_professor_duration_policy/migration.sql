ALTER TABLE "ClubSettings"
  ADD COLUMN "professorDurationOverrideEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "professorDurationOverrideMinutes" INTEGER NOT NULL DEFAULT 60;

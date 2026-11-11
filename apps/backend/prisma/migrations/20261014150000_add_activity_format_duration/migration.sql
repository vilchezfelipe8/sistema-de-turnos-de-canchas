-- Duración fija por modalidad (null = usa las duraciones de la actividad)
ALTER TABLE "ActivityFormat" ADD COLUMN "durationMinutes" INTEGER;

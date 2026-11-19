-- Clubes que no aparecen en la lista pública de la app.
ALTER TABLE "Club" ADD COLUMN "isListed" BOOLEAN NOT NULL DEFAULT true;

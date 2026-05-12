-- Migration: add clientId to Account (P2-A)
-- Allows associating a Client to a BAR/POS account for visibility and reporting.

ALTER TABLE "Account" ADD COLUMN "clientId" TEXT;

ALTER TABLE "Account" ADD CONSTRAINT "Account_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Account_clientId_idx" ON "Account"("clientId");

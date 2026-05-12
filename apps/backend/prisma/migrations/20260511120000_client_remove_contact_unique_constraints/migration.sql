-- Commit 2: Remove unique constraints on Client contact fields (email, phone, dni).
-- These constraints blocked valid multi-client scenarios (same person, different admin entries).
-- Replace with plain indices for query performance.

-- DropIndex
DROP INDEX IF EXISTS "Client_clubId_email_key";

-- DropIndex
DROP INDEX IF EXISTS "Client_clubId_phone_key";

-- DropIndex
DROP INDEX IF EXISTS "Client_clubId_dni_key";

-- CreateIndex (plain, non-unique — email)
CREATE INDEX IF NOT EXISTS "Client_clubId_email_idx" ON "Client"("clubId", "email");

-- CreateIndex (plain, non-unique — phone)
CREATE INDEX IF NOT EXISTS "Client_clubId_phone_idx" ON "Client"("clubId", "phone");

-- Note: Client_clubId_dni_idx already exists from migration 20260325003000_client_duplicate_incidents_v1
-- No action needed for dni index.

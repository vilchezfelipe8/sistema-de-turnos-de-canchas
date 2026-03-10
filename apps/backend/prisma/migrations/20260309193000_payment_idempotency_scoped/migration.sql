DROP INDEX IF EXISTS "Payment_idempotencyKey_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_accountId_idempotencyKey_key"
ON "Payment"("accountId", "idempotencyKey")
WHERE "idempotencyKey" IS NOT NULL;

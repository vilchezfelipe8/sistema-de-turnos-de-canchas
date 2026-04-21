-- Ejecutar solo después de correr `npm run preflight:stabilization`
-- y corregir los duplicados reportados.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Account_clubId_sourceType_sourceId_key"
  ON "Account"("clubId", "sourceType", "sourceId");

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "CashRegister_clubId_name_key"
  ON "CashRegister"("clubId", "name");

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "CashShift_one_open_per_register_key"
  ON "CashShift"("cashRegisterId")
  WHERE "status" = 'OPEN'::"CashShiftStatus";

import fs from 'fs';
import path from 'path';
import { prisma } from '../prisma';

type CheckResult = {
  name: string;
  status: 'ok' | 'warning' | 'error';
  detail: string;
};

const workspaceRoot = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(workspaceRoot, 'prisma', 'migrations');

const checkMigrationPrefixes = (): CheckResult => {
  const results = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const prefixes = new Map<string, string[]>();
  for (const name of results) {
    const prefix = name.split('_')[0];
    const items = prefixes.get(prefix) ?? [];
    items.push(name);
    prefixes.set(prefix, items);
  }

  const duplicates = [...prefixes.entries()].filter(([, names]) => names.length > 1);
  if (duplicates.length === 0) {
    return { name: 'migration_prefixes', status: 'ok', detail: 'Sin prefijos duplicados de migración.' };
  }

  return {
    name: 'migration_prefixes',
    status: 'warning',
    detail: duplicates.map(([prefix, names]) => `${prefix}: ${names.join(', ')}`).join(' | ')
  };
};

const hasColumn = async (tableName: string, columnName: string) => {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS "exists"
  `;

  return Boolean(rows[0]?.exists);
};

const run = async () => {
  const checks: CheckResult[] = [];
  checks.push(checkMigrationPrefixes());

  const hasAccountItemProductId = await hasColumn('AccountItem', 'productId');

  const [
    duplicateAccounts,
    duplicateCashRegisters,
    multipleOpenShifts,
    mismatchedCashMovements,
    mismatchedLedgerEntries,
    historicalShiftWithoutUserOne,
    bookingClubMismatches,
    courtActivityMismatches,
    courtPriceRuleMismatches,
    paymentCashShiftMismatches,
    pendingEvents,
    productItemsWithoutProduct
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ clubId: number; sourceType: string; sourceId: string; qty: bigint }>>`
      SELECT "clubId", "sourceType", "sourceId", COUNT(*)::bigint AS qty
      FROM "Account"
      GROUP BY "clubId", "sourceType", "sourceId"
      HAVING COUNT(*) > 1
    `,
    prisma.$queryRaw<Array<{ clubId: number; name: string; qty: bigint }>>`
      SELECT "clubId", "name", COUNT(*)::bigint AS qty
      FROM "CashRegister"
      GROUP BY "clubId", "name"
      HAVING COUNT(*) > 1
    `,
    prisma.$queryRaw<Array<{ cashRegisterId: string; qty: bigint }>>`
      SELECT "cashRegisterId", COUNT(*)::bigint AS qty
      FROM "CashShift"
      WHERE "status" = 'OPEN'::"CashShiftStatus"
      GROUP BY "cashRegisterId"
      HAVING COUNT(*) > 1
    `,
    prisma.$queryRaw<Array<{ paymentId: string; cashMovementClubId: number; accountClubId: number }>>`
      SELECT cm."paymentId", cm."clubId" AS "cashMovementClubId", a."clubId" AS "accountClubId"
      FROM "CashMovement" cm
      JOIN "Payment" p ON p."id" = cm."paymentId"
      JOIN "Account" a ON a."id" = p."accountId"
      WHERE cm."paymentId" IS NOT NULL
        AND cm."clubId" <> a."clubId"
    `,
    prisma.$queryRaw<Array<{ ledgerEntryId: string; ledgerClubId: number; accountClubId: number }>>`
      SELECT le."id" AS "ledgerEntryId", le."clubId" AS "ledgerClubId", a."clubId" AS "accountClubId"
      FROM "LedgerEntry" le
      JOIN "Account" a ON a."id" = le."accountId"
      WHERE le."accountId" IS NOT NULL
        AND le."clubId" <> a."clubId"
    `,
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT cs."id"
      FROM "CashShift" cs
      WHERE cs."id" LIKE 'legacy-shift-%'
        AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = 1)
    `,
    prisma.$queryRaw<Array<{ bookingId: number }>>`
      SELECT b."id" AS "bookingId"
      FROM "Booking" b
      JOIN "Court" c ON c."id" = b."courtId"
      JOIN "ActivityType" a ON a."id" = b."activityId"
      WHERE b."clubId" <> c."clubId"
         OR b."clubId" <> a."clubId"
    `,
    prisma.$queryRaw<Array<{ courtId: number }>>`
      SELECT c."id" AS "courtId"
      FROM "Court" c
      JOIN "ActivityType" a ON a."id" = c."activityTypeId"
      WHERE c."activityTypeId" IS NOT NULL
        AND c."clubId" <> a."clubId"
    `,
    prisma.$queryRaw<Array<{ ruleId: number }>>`
      SELECT cpr."id" AS "ruleId"
      FROM "CourtPriceRule" cpr
      JOIN "Court" c ON c."id" = cpr."courtId"
      WHERE cpr."clubId" <> c."clubId"
    `,
    prisma.$queryRaw<Array<{ paymentId: string }>>`
      SELECT p."id" AS "paymentId"
      FROM "Payment" p
      JOIN "Account" a ON a."id" = p."accountId"
      JOIN "CashShift" cs ON cs."id" = p."cashShiftId"
      JOIN "CashRegister" cr ON cr."id" = cs."cashRegisterId"
      WHERE p."cashShiftId" IS NOT NULL
        AND a."clubId" <> cr."clubId"
    `,
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Event"
      WHERE "processed" = false
    `,
    hasAccountItemProductId
      ? prisma.$queryRaw<Array<{ id: string }>>`
          SELECT ai."id"
          FROM "AccountItem" ai
          WHERE ai."type" = 'PRODUCT'::"AccountItemType"
            AND ai."productId" IS NULL
        `
      : Promise.resolve([])
  ]);

  checks.push({
    name: 'duplicate_accounts',
    status: duplicateAccounts.length > 0 ? 'error' : 'ok',
    detail: duplicateAccounts.length > 0
      ? `${duplicateAccounts.length} claves (clubId, sourceType, sourceId) duplicadas.`
      : 'Sin cuentas duplicadas por origen.'
  });

  checks.push({
    name: 'duplicate_cash_registers',
    status: duplicateCashRegisters.length > 0 ? 'error' : 'ok',
    detail: duplicateCashRegisters.length > 0
      ? `${duplicateCashRegisters.length} cajas duplicadas por (clubId, name).`
      : 'Sin cajas duplicadas por nombre.'
  });

  checks.push({
    name: 'multiple_open_shifts',
    status: multipleOpenShifts.length > 0 ? 'error' : 'ok',
    detail: multipleOpenShifts.length > 0
      ? `${multipleOpenShifts.length} cajas con más de un turno abierto.`
      : 'Sin cajas con múltiples turnos abiertos.'
  });

  checks.push({
    name: 'cash_movement_account_club_mismatch',
    status: mismatchedCashMovements.length > 0 ? 'error' : 'ok',
    detail: mismatchedCashMovements.length > 0
      ? `${mismatchedCashMovements.length} cash movements referencian pagos/cuentas de otro club.`
      : 'CashMovement consistente con Account.'
  });

  checks.push({
    name: 'ledger_account_club_mismatch',
    status: mismatchedLedgerEntries.length > 0 ? 'error' : 'ok',
    detail: mismatchedLedgerEntries.length > 0
      ? `${mismatchedLedgerEntries.length} ledger entries referencian cuentas de otro club.`
      : 'LedgerEntry consistente con Account.'
  });

  checks.push({
    name: 'historical_shift_backfill',
    status: historicalShiftWithoutUserOne.length > 0 ? 'warning' : 'ok',
    detail: historicalShiftWithoutUserOne.length > 0
      ? 'Existen turnos historicos y no existe User.id = 1. Revisar backfill historico.'
      : 'Sin dependencia activa del backfill historico User.id = 1.'
  });

  checks.push({
    name: 'booking_same_club_mismatch',
    status: bookingClubMismatches.length > 0 ? 'error' : 'ok',
    detail: bookingClubMismatches.length > 0
      ? `${bookingClubMismatches.length} bookings referencian cancha/actividad de otro club.`
      : 'Booking consistente con Court y ActivityType.'
  });

  checks.push({
    name: 'court_activity_same_club_mismatch',
    status: courtActivityMismatches.length > 0 ? 'error' : 'ok',
    detail: courtActivityMismatches.length > 0
      ? `${courtActivityMismatches.length} canchas apuntan a una actividad de otro club.`
      : 'Court consistente con ActivityType.'
  });

  checks.push({
    name: 'court_price_rule_same_club_mismatch',
    status: courtPriceRuleMismatches.length > 0 ? 'error' : 'ok',
    detail: courtPriceRuleMismatches.length > 0
      ? `${courtPriceRuleMismatches.length} reglas de precio referencian cancha de otro club.`
      : 'CourtPriceRule consistente con Court.'
  });

  checks.push({
    name: 'payment_cash_shift_same_club_mismatch',
    status: paymentCashShiftMismatches.length > 0 ? 'error' : 'ok',
    detail: paymentCashShiftMismatches.length > 0
      ? `${paymentCashShiftMismatches.length} pagos POS están asociados a caja de otro club.`
      : 'Payment consistente con CashShift.'
  });

  checks.push({
    name: 'events_pending',
    status: pendingEvents.length > 0 ? 'warning' : 'ok',
    detail: pendingEvents.length > 0
      ? `${pendingEvents.length} eventos siguen pendientes y deben marcarse como procesados antes del retiro definitivo.`
      : 'Sin backlog pendiente en Event.'
  });

  checks.push({
    name: 'product_items_without_product_link',
    status: !hasAccountItemProductId ? 'warning' : productItemsWithoutProduct.length > 0 ? 'warning' : 'ok',
    detail: !hasAccountItemProductId
      ? 'La columna AccountItem.productId todavía no existe en esta base. Aplicar migraciones y rerun preflight.'
      : productItemsWithoutProduct.length > 0
        ? `${productItemsWithoutProduct.length} consumos PRODUCT sin productId no podran revertir stock automaticamente.`
      : 'Los consumos PRODUCT ya conservan vínculo a Product.'
  });

  for (const check of checks) {
    const prefix = check.status === 'ok' ? 'OK' : check.status === 'warning' ? 'WARN' : 'ERROR';
    console.log(`[${prefix}] ${check.name}: ${check.detail}`);
  }

  const hasErrors = checks.some((check) => check.status === 'error');
  await prisma.$disconnect();
  if (hasErrors) {
    process.exit(1);
  }
};

run().catch(async (error) => {
  console.error('[ERROR] preflight_stabilization:', error);
  await prisma.$disconnect();
  process.exit(1);
});

import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

const DRY_RUN = process.env.DRY_RUN !== 'false';
const AUTO_CLOSE_DUPLICATE_SHIFTS = process.env.AUTO_CLOSE_DUPLICATE_SHIFTS === 'true';

const log = (message: string, payload?: Record<string, unknown>) => {
  console.log(JSON.stringify({ msg: message, dryRun: DRY_RUN, ...(payload || {}) }));
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

const mergeDuplicateAccounts = async () => {
  const groups = await prisma.$queryRaw<Array<{
    clubId: number;
    sourceType: string;
    sourceId: string;
  }>>`
    SELECT "clubId", "sourceType", "sourceId"
    FROM "Account"
    GROUP BY "clubId", "sourceType", "sourceId"
    HAVING COUNT(*) > 1
  `;

  for (const group of groups) {
    const accounts = await prisma.account.findMany({
      where: {
        clubId: group.clubId,
        sourceType: group.sourceType as any,
        sourceId: group.sourceId
      },
      orderBy: { createdAt: 'asc' }
    });

    const [canonical, ...duplicates] = accounts;
    if (!canonical || duplicates.length === 0) continue;

    log('merge_duplicate_account_group', {
      clubId: group.clubId,
      sourceType: group.sourceType,
      sourceId: group.sourceId,
      canonicalAccountId: canonical.id,
      duplicates: duplicates.map((account) => account.id)
    });

    if (DRY_RUN) continue;

    await prisma.$transaction(async (tx) => {
      for (const duplicate of duplicates) {
        await tx.accountItem.updateMany({
          where: { accountId: duplicate.id },
          data: { accountId: canonical.id }
        });

        await tx.payment.updateMany({
          where: { accountId: duplicate.id },
          data: { accountId: canonical.id }
        });

        await tx.ledgerEntry.updateMany({
          where: { accountId: duplicate.id },
          data: { accountId: canonical.id }
        });

        await tx.accountSummaryProjection.deleteMany({
          where: { accountId: duplicate.id }
        });

        await tx.account.delete({
          where: { id: duplicate.id }
        });
      }

      const totals = await tx.account.findUnique({
        where: { id: canonical.id },
        include: {
          items: true,
          payments: true,
          refunds: true
        }
      });

      if (!totals) return;

      const totalAmount = totals.items.reduce((sum, item) => sum + Number(item.total || 0), 0);
      const paymentAmount = totals.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const refundedAmount = totals.refunds.reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
      const paidAmount = Math.max(0, Number((paymentAmount - refundedAmount).toFixed(2)));
      const status = paidAmount + 0.009 >= totalAmount ? 'CLOSED' : 'OPEN';

      await tx.account.update({
        where: { id: canonical.id },
        data: {
          totalAmount: new Prisma.Decimal(totalAmount),
          paidAmount: new Prisma.Decimal(paidAmount),
          status,
          closedAt: status === 'CLOSED' ? (canonical.closedAt ?? new Date()) : null
        }
      });
    });
  }
};

const renameDuplicateCashRegisters = async () => {
  const groups = await prisma.$queryRaw<Array<{
    clubId: number;
    name: string;
  }>>`
    SELECT "clubId", "name"
    FROM "CashRegister"
    GROUP BY "clubId", "name"
    HAVING COUNT(*) > 1
  `;

  for (const group of groups) {
    const registers = await prisma.cashRegister.findMany({
      where: {
        clubId: group.clubId,
        name: group.name
      },
      orderBy: { createdAt: 'asc' }
    });

    const [, ...duplicates] = registers;
    for (const duplicate of duplicates) {
      const nextName = `${duplicate.name} (${duplicate.id.slice(0, 6)})`;
      log('rename_duplicate_cash_register', {
        cashRegisterId: duplicate.id,
        previousName: duplicate.name,
        nextName
      });

      if (!DRY_RUN) {
        await prisma.cashRegister.update({
          where: { id: duplicate.id },
          data: { name: nextName }
        });
      }
    }
  }
};

const closeDuplicateOpenShifts = async () => {
  const groups = await prisma.$queryRaw<Array<{ cashRegisterId: string }>>`
    SELECT "cashRegisterId"
    FROM "CashShift"
    WHERE "status" = 'OPEN'::"CashShiftStatus"
    GROUP BY "cashRegisterId"
    HAVING COUNT(*) > 1
  `;

  for (const group of groups) {
    const shifts = await prisma.cashShift.findMany({
      where: {
        cashRegisterId: group.cashRegisterId,
        status: 'OPEN'
      },
      orderBy: { openedAt: 'desc' }
    });

    const [keepOpen, ...toClose] = shifts;
    log('duplicate_open_shift_group', {
      cashRegisterId: group.cashRegisterId,
      keepOpenShiftId: keepOpen?.id,
      closeShiftIds: toClose.map((shift) => shift.id),
      autoClose: AUTO_CLOSE_DUPLICATE_SHIFTS
    });

    if (DRY_RUN || !AUTO_CLOSE_DUPLICATE_SHIFTS) continue;

    for (const shift of toClose) {
      await prisma.cashShift.update({
        where: { id: shift.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          expectedCash: shift.openingAmount,
          countedCash: shift.openingAmount,
          difference: new Prisma.Decimal(0)
        }
      });
    }
  }
};

const markPendingEventsProcessed = async () => {
  const pending = await prisma.event.count({
    where: { processed: false }
  });

  log('mark_pending_events_processed', { pending });

  if (!DRY_RUN && pending > 0) {
    await prisma.event.updateMany({
      where: { processed: false },
      data: { processed: true }
    });
  }
};

const backfillProductLinks = async () => {
  const hasAccountItemProductId = await hasColumn('AccountItem', 'productId');
  if (!hasAccountItemProductId) {
    log('backfill_account_item_product_skipped', {
      reason: 'column_missing',
      column: 'AccountItem.productId'
    });
    return;
  }

  const items = await prisma.$queryRaw<Array<{ accountItemId: string; productId: number }>>`
    SELECT ai."id" AS "accountItemId", MIN(p."id") AS "productId"
    FROM "AccountItem" ai
    JOIN "Account" a ON a."id" = ai."accountId"
    JOIN "Product" p ON p."clubId" = a."clubId" AND p."name" = ai."description"
    WHERE ai."type" = 'PRODUCT'::"AccountItemType"
      AND ai."productId" IS NULL
    GROUP BY ai."id"
    HAVING COUNT(p."id") = 1
  `;

  for (const item of items) {
    log('backfill_account_item_product', item);
    if (!DRY_RUN) {
      await prisma.accountItem.update({
        where: { id: item.accountItemId },
        data: { productId: item.productId }
      });
    }
  }
};

const run = async () => {
  await mergeDuplicateAccounts();
  await renameDuplicateCashRegisters();
  await closeDuplicateOpenShifts();
  await markPendingEventsProcessed();
  await backfillProductLinks();

  await prisma.$disconnect();
};

run().catch(async (error) => {
  console.error('[ERROR] fix_stabilization_data:', error);
  await prisma.$disconnect();
  process.exit(1);
});

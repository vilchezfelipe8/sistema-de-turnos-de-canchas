import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

const rebuildAccountSummaries = async () => {
  const accounts = await prisma.account.findMany();
  const accountIds = accounts.map((account) => account.id);
  const [paymentAgg, refundAgg] = await Promise.all([
    accountIds.length > 0
      ? prisma.payment.groupBy({
          by: ['accountId'],
          where: { accountId: { in: accountIds } },
          _sum: { amount: true }
        })
      : Promise.resolve([] as Array<{ accountId: string; _sum: { amount: Prisma.Decimal | null } }>),
    accountIds.length > 0
      ? prisma.refund.groupBy({
          by: ['accountId'],
          where: { accountId: { in: accountIds }, status: 'EXECUTED' },
          _sum: { amount: true }
        })
      : Promise.resolve([] as Array<{ accountId: string; _sum: { amount: Prisma.Decimal | null } }>)
  ]);

  const paymentByAccount = new Map(paymentAgg.map((row) => [row.accountId, Number(row._sum.amount || 0)]));
  const refundByAccount = new Map(refundAgg.map((row) => [row.accountId, Number(row._sum.amount || 0)]));

  await prisma.accountSummaryProjection.deleteMany();
  if (accounts.length === 0) return 0;

  await prisma.accountSummaryProjection.createMany({
    data: accounts.map((account) => {
      const totalAmount = Number(account.totalAmount || 0);
      const paidAmount = Math.max(0, (paymentByAccount.get(account.id) || 0) - (refundByAccount.get(account.id) || 0));
      return {
        accountId: account.id,
        clubId: account.clubId,
        sourceType: account.sourceType,
        sourceId: account.sourceId,
        status: account.status,
        totalAmount: new Prisma.Decimal(totalAmount),
        paidAmount: new Prisma.Decimal(paidAmount),
        remaining: new Prisma.Decimal(Number((totalAmount - paidAmount).toFixed(2)))
      };
    })
  });

  return accounts.length;
};

const rebuildCashShiftSummaries = async () => {
  const shifts = await prisma.cashShift.findMany({
    include: {
      cashRegister: { select: { clubId: true } },
      movements: true
    }
  });

  await prisma.cashShiftSummaryProjection.deleteMany();
  if (shifts.length === 0) return 0;

  await prisma.cashShiftSummaryProjection.createMany({
    data: shifts.map((shift) => {
      const totals = shift.movements.reduce(
        (acc, movement) => {
          const amount = Number(movement.amount || 0);
          if (movement.type === 'PAYMENT_IN') acc.paymentIn += amount;
          if (movement.type === 'DEPOSIT') acc.deposit += amount;
          if (movement.type === 'WITHDRAW') acc.withdraw += amount;
          if (movement.type === 'REFUND') acc.refund += amount;
          return acc;
        },
        { paymentIn: 0, deposit: 0, withdraw: 0, refund: 0 }
      );

      return {
        shiftId: shift.id,
        clubId: shift.cashRegister.clubId,
        cashRegisterId: shift.cashRegisterId,
        status: shift.status,
        openingAmount: new Prisma.Decimal(Number(shift.openingAmount || 0)),
        expectedCash: shift.expectedCash == null ? null : new Prisma.Decimal(Number(shift.expectedCash || 0)),
        countedCash: shift.countedCash == null ? null : new Prisma.Decimal(Number(shift.countedCash || 0)),
        difference: shift.difference == null ? null : new Prisma.Decimal(Number(shift.difference || 0)),
        paymentIn: new Prisma.Decimal(totals.paymentIn),
        deposit: new Prisma.Decimal(totals.deposit),
        withdraw: new Prisma.Decimal(totals.withdraw),
        refund: new Prisma.Decimal(totals.refund)
      };
    })
  });

  return shifts.length;
};

const rebuildDailyCashSummaries = async () => {
  const rows = await prisma.$queryRaw<Array<{
    clubId: number;
    day: Date;
    cashIn: Prisma.Decimal;
    cashOut: Prisma.Decimal;
  }>>`
    SELECT
      "clubId",
      DATE("createdAt") AS "day",
      COALESCE(SUM(CASE WHEN "method" = 'CASH'::"CashMovementMethod" AND "type" IN ('PAYMENT_IN'::"CashMovementPosType", 'DEPOSIT'::"CashMovementPosType") THEN "amount" ELSE 0 END), 0) AS "cashIn",
      COALESCE(SUM(CASE WHEN "method" = 'CASH'::"CashMovementMethod" AND "type" IN ('WITHDRAW'::"CashMovementPosType", 'REFUND'::"CashMovementPosType") THEN "amount" ELSE 0 END), 0) AS "cashOut"
    FROM "CashMovement"
    GROUP BY "clubId", DATE("createdAt")
  `;

  await prisma.dailyCashSummaryProjection.deleteMany();
  if (rows.length === 0) return 0;

  await prisma.dailyCashSummaryProjection.createMany({
    data: rows.map((row) => {
      const cashIn = Number(row.cashIn || 0);
      const cashOut = Number(row.cashOut || 0);
      return {
        clubId: row.clubId,
        day: row.day,
        cashIn: new Prisma.Decimal(cashIn),
        cashOut: new Prisma.Decimal(cashOut),
        netCash: new Prisma.Decimal(Number((cashIn - cashOut).toFixed(2)))
      };
    })
  });

  return rows.length;
};

const run = async () => {
  const [accounts, shifts, daily] = await Promise.all([
    rebuildAccountSummaries(),
    rebuildCashShiftSummaries(),
    rebuildDailyCashSummaries()
  ]);

  console.log(JSON.stringify({
    ok: true,
    rebuilt: {
      accountSummaryProjection: accounts,
      cashShiftSummaryProjection: shifts,
      dailyCashSummaryProjection: daily
    }
  }));

  await prisma.$disconnect();
};

run().catch(async (error) => {
  console.error('[ERROR] rebuild_read_models:', error);
  await prisma.$disconnect();
  process.exit(1);
});

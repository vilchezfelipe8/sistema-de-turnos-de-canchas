import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';

type DbClient = Prisma.TransactionClient | PrismaClient;

export class ProjectionService {
  async refreshAccountSummary(accountId: string, tx?: DbClient) {
    const client = tx ?? prisma;
    const account = await client.account.findUnique({
      where: { id: accountId }
    });

    if (!account) {
      await client.accountSummaryProjection.deleteMany({ where: { accountId } });
      return null;
    }

    const totalAmount = Number(account.totalAmount || 0);
    const [paymentsAgg, refundsAgg] = await Promise.all([
      client.payment.aggregate({
        where: { accountId: account.id },
        _sum: { amount: true }
      }),
      client.refund.aggregate({
        where: { accountId: account.id, status: 'EXECUTED' },
        _sum: { amount: true }
      })
    ]);
    const paidAmount = Number(Math.max(0, Number(paymentsAgg._sum.amount || 0) - Number(refundsAgg._sum.amount || 0)));
    const remaining = Number((totalAmount - paidAmount).toFixed(2));

    return client.accountSummaryProjection.upsert({
      where: { accountId },
      update: {
        clubId: account.clubId,
        sourceType: account.sourceType,
        sourceId: account.sourceId,
        status: account.status,
        totalAmount: new Prisma.Decimal(totalAmount),
        paidAmount: new Prisma.Decimal(paidAmount),
        remaining: new Prisma.Decimal(remaining)
      },
      create: {
        accountId: account.id,
        clubId: account.clubId,
        sourceType: account.sourceType,
        sourceId: account.sourceId,
        status: account.status,
        totalAmount: new Prisma.Decimal(totalAmount),
        paidAmount: new Prisma.Decimal(paidAmount),
        remaining: new Prisma.Decimal(remaining)
      }
    });
  }

  async refreshCashShiftSummary(shiftId: string, tx?: DbClient) {
    const client = tx ?? prisma;
    const shift = await client.cashShift.findUnique({
      where: { id: shiftId },
      include: {
        cashRegister: { select: { clubId: true } },
        movements: true
      }
    });

    if (!shift) {
      await client.cashShiftSummaryProjection.deleteMany({ where: { shiftId } });
      return null;
    }

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

    return client.cashShiftSummaryProjection.upsert({
      where: { shiftId },
      update: {
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
      },
      create: {
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
      }
    });
  }

  async refreshDailyCashSummary(clubId: number, day: Date, tx?: DbClient) {
    const client = tx ?? prisma;
    const dayStart = new Date(day);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const rows = await client.$queryRaw<Array<{
      cashIn: Prisma.Decimal;
      cashOut: Prisma.Decimal;
    }>>`
      SELECT
        COALESCE(SUM(CASE WHEN "method" = 'CASH'::"CashMovementMethod" AND "type" IN ('PAYMENT_IN'::"CashMovementPosType", 'DEPOSIT'::"CashMovementPosType") THEN "amount" ELSE 0 END), 0) AS "cashIn",
        COALESCE(SUM(CASE WHEN "method" = 'CASH'::"CashMovementMethod" AND "type" IN ('WITHDRAW'::"CashMovementPosType", 'REFUND'::"CashMovementPosType") THEN "amount" ELSE 0 END), 0) AS "cashOut"
      FROM "CashMovement"
      WHERE "clubId" = ${clubId}
        AND "createdAt" >= ${dayStart}
        AND "createdAt" < ${dayEnd}
    `;

    const row = rows[0];
    const cashIn = Number(row?.cashIn || 0);
    const cashOut = Number(row?.cashOut || 0);
    const netCash = Number((cashIn - cashOut).toFixed(2));

    return client.dailyCashSummaryProjection.upsert({
      where: {
        clubId_day: {
          clubId,
          day: dayStart
        }
      },
      update: {
        cashIn: new Prisma.Decimal(cashIn),
        cashOut: new Prisma.Decimal(cashOut),
        netCash: new Prisma.Decimal(netCash)
      },
      create: {
        clubId,
          day: dayStart,
        cashIn: new Prisma.Decimal(cashIn),
        cashOut: new Prisma.Decimal(cashOut),
        netCash: new Prisma.Decimal(netCash)
      }
    });
  }
}

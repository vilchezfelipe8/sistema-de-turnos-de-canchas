import { Prisma } from '@prisma/client';
import { prisma, prismaRead } from '../prisma';
import { AccountingService } from './AccountingService';
import { acquireTransactionAdvisoryLock } from '../utils/advisoryLock';
import { ProjectionService } from './ProjectionService';
import { getDerivedPaymentStatus } from '../domain/bookingDomain';

const USE_PROJECTION_READ_MODELS = String(process.env.READ_MODEL_SOURCE || '').toLowerCase() === 'projection';
const EPSILON = 0.009;

type OpenAccountInput = {
  clubId: number;
  sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL';
  sourceId: string;
};

export class AccountService {
  private readonly accountingService = new AccountingService();
  private readonly projectionService = new ProjectionService();

  async calculateNetPaidAmountTx(tx: Prisma.TransactionClient, accountId: string): Promise<number> {
    const [paymentsAgg, refundsAgg] = await Promise.all([
      tx.payment.aggregate({
        where: { accountId },
        _sum: { amount: true }
      }),
      tx.refund.aggregate({
        where: { accountId, status: 'EXECUTED' },
        _sum: { amount: true }
      })
    ]);

    const totalPayments = Number(paymentsAgg._sum.amount || 0);
    const totalRefunds = Number(refundsAgg._sum.amount || 0);
    return Number(Math.max(0, totalPayments - totalRefunds).toFixed(2));
  }

  async calculateNetPaidAmount(accountId: string): Promise<number> {
    const [paymentsAgg, refundsAgg] = await Promise.all([
      prismaRead.payment.aggregate({
        where: { accountId },
        _sum: { amount: true }
      }),
      prismaRead.refund.aggregate({
        where: { accountId, status: 'EXECUTED' },
        _sum: { amount: true }
      })
    ]);

    const totalPayments = Number(paymentsAgg._sum.amount || 0);
    const totalRefunds = Number(refundsAgg._sum.amount || 0);
    return Number(Math.max(0, totalPayments - totalRefunds).toFixed(2));
  }

  async reconcilePaidAmountTx(tx: Prisma.TransactionClient, accountId: string, options?: {
    updateStatus?: boolean;
    reopenIfRemaining?: boolean;
  }) {
    const account = await tx.account.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('Cuenta no encontrada');

    const netPaid = await this.calculateNetPaidAmountTx(tx, accountId);
    const currentPaid = Number(account.paidAmount || 0);
    const total = Number(account.totalAmount || 0);
    const remaining = Number((total - netPaid).toFixed(2));

    const mustUpdatePaid = Math.abs(currentPaid - netPaid) > EPSILON;

    const updateData: Prisma.AccountUpdateInput = {};
    if (mustUpdatePaid) {
      updateData.paidAmount = new Prisma.Decimal(netPaid);
    }

    if (options?.updateStatus) {
      // Para BOOKING no cerramos automáticamente por saldo 0:
      // puede haber nuevos consumos durante la gestión de la reserva.
      const canAutoCloseByBalance = account.sourceType !== 'BOOKING';
      if (canAutoCloseByBalance && account.status === 'OPEN' && remaining <= EPSILON) {
        updateData.status = 'CLOSED';
        updateData.closedAt = new Date();
      }
      if (options.reopenIfRemaining && account.status === 'CLOSED' && remaining > EPSILON) {
        updateData.status = 'OPEN';
        updateData.closedAt = null;
      }
    }

    if (Object.keys(updateData).length > 0) {
      await tx.account.update({
        where: { id: accountId },
        data: updateData
      });
    }

    return {
      netPaid,
      total,
      remaining
    };
  }

  async cancelItemsForSourceTx(tx: Prisma.TransactionClient, input: {
    sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL';
    sourceId: string | number;
  }) {
    const sourceId = String(input.sourceId);

    const account = await tx.account.findFirst({
      where: {
        sourceType: input.sourceType,
        sourceId
      },
      include: {
        items: { orderBy: { createdAt: 'asc' } }
      }
    });

    if (!account) {
      return null;
    }

    const total = Number(account.totalAmount || 0);
    const paid = await this.calculateNetPaidAmountTx(tx, account.id);
    const remaining = Number((total - paid).toFixed(2));

    if (remaining <= 0.009) {
      if (account.status !== 'CLOSED') {
        await tx.account.update({
          where: { id: account.id },
          data: {
            status: 'CLOSED',
            closedAt: new Date()
          }
        });
        await this.projectionService.refreshAccountSummary(account.id, tx);
      }
      return account;
    }

    const cancelDescription = `Cancelación obligaciones ${input.sourceType}#${sourceId}`;

    const adjustmentItem = await tx.accountItem.create({
      data: {
        accountId: account.id,
        type: 'ADJUSTMENT',
        description: cancelDescription,
        quantity: 1,
        unitPrice: new Prisma.Decimal(-remaining),
        total: new Prisma.Decimal(-remaining)
      }
    });

    await tx.account.update({
      where: { id: account.id },
      data: {
        totalAmount: { decrement: new Prisma.Decimal(remaining) },
        status: 'CLOSED',
        closedAt: new Date()
      }
    });

    await this.accountingService.reverseAccountItemTransaction(tx, {
      clubId: account.clubId,
      type: 'ADJUSTMENT',
      referenceType: 'ACCOUNT_ITEM',
      referenceId: adjustmentItem.id,
      accountId: account.id,
      accountItemId: adjustmentItem.id,
      amount: remaining,
      revenueAccount: 'ADJUSTMENTS',
      description: cancelDescription
    });

    await this.projectionService.refreshAccountSummary(account.id, tx);

    return tx.account.findFirst({ where: { id: account.id } });
  }

  async cancelItemsForSource(input: {
    sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL';
    sourceId: string | number;
  }) {
    return prisma.$transaction(async (tx) => {
      return this.cancelItemsForSourceTx(tx, input);
    });
  }

  async openAccount(input: OpenAccountInput) {
    return prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(
        tx,
        `account:${input.clubId}:${input.sourceType}:${input.sourceId}`
      );

      const existing = await tx.account.findFirst({
        where: {
          clubId: input.clubId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          status: { in: ['OPEN', 'CLOSED'] }
        }
      });

      if (existing) {
        await this.projectionService.refreshAccountSummary(existing.id, tx);
        return existing;
      }

      if (input.sourceType === 'BOOKING') {
        const booking = await tx.booking.findFirst({
          where: { id: Number(input.sourceId), clubId: input.clubId },
          select: { id: true, status: true }
        });
        if (!booking) throw new Error('No se puede abrir cuenta: la reserva no existe');
        if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
          throw new Error('No se puede abrir cuenta para una reserva terminal');
        }
      }

      const account = await tx.account.create({
        data: {
          clubId: input.clubId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          status: 'OPEN'
        }
      });

      await this.projectionService.refreshAccountSummary(account.id, tx);
      return account;
    });
  }

  async listAccounts(clubId: number, status?: 'OPEN' | 'CLOSED', bookingId?: number) {
    return prismaRead.account.findMany({
      where: {
        clubId,
        ...(status ? { status } : {}),
        ...(bookingId ? { sourceType: 'BOOKING', sourceId: String(bookingId) } : {})
      },
      include: {
        items: true,
        payments: { include: { allocations: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getAccount(clubId: number, accountId: string) {
    const account = await prismaRead.account.findFirst({
      where: { id: accountId, clubId },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        payments: { orderBy: { createdAt: 'asc' }, include: { allocations: true } }
      }
    });

    if (!account) throw new Error('Cuenta no encontrada');

    const total = Number(account.totalAmount || 0);
    const paid = await this.calculateNetPaidAmount(account.id);
    const remaining = Number((total - paid).toFixed(2));

    return {
      account,
      items: account.items,
      payments: account.payments,
      total,
      paid,
      remaining
    };
  }

  async getAccountSummary(clubId: number, accountId: string) {
    if (USE_PROJECTION_READ_MODELS) {
      const projection = await prismaRead.accountSummaryProjection.findFirst({
        where: { accountId, clubId }
      });
      if (projection) {
        return {
          accountId,
          itemsTotal: Number(projection.totalAmount || 0),
          paymentsTotal: Number(projection.paidAmount || 0),
          remaining: Number(projection.remaining || 0),
          paymentStatus: getDerivedPaymentStatus(Number(projection.totalAmount || 0), Number(projection.paidAmount || 0)),
          isBalanced: Math.abs(Number(projection.remaining || 0)) <= EPSILON,
          status: projection.status
        };
      }
    }

    const account = await prismaRead.account.findFirst({
      where: { id: accountId, clubId },
      include: { items: true, payments: true }
    });

    if (!account) throw new Error('Cuenta no encontrada');

    const balance = await this.getBalance(clubId, accountId);

    return {
      accountId,
      itemsTotal: balance.total,
      paymentsTotal: balance.paid,
      remaining: balance.remaining,
      paymentStatus: getDerivedPaymentStatus(balance.total, balance.paid),
      isBalanced: Math.abs(balance.remaining) <= EPSILON,
      status: account.status
    };
  }

  async getBalance(clubId: number, accountId: string) {
    if (USE_PROJECTION_READ_MODELS) {
      const projection = await prismaRead.accountSummaryProjection.findFirst({
        where: { accountId, clubId }
      });
      if (projection) {
        return {
          accountId,
          total: Number(Number(projection.totalAmount || 0).toFixed(2)),
          paid: Number(Number(projection.paidAmount || 0).toFixed(2)),
          remaining: Number(Number(projection.remaining || 0).toFixed(2))
        };
      }
    }

    const account = await prismaRead.account.findFirst({ where: { id: accountId, clubId } });
    if (!account) throw new Error('Cuenta no encontrada');

    const total = Number(account.totalAmount || 0);
    const paid = await this.calculateNetPaidAmount(account.id);

    return {
      accountId,
      total: Number(total.toFixed(2)),
      paid: Number(paid.toFixed(2)),
      remaining: Number((total - paid).toFixed(2))
    };
  }

  async getLedger(clubId: number, accountId: string) {
    const account = await prismaRead.account.findFirst({ where: { id: accountId, clubId } });
    if (!account) throw new Error('Cuenta no encontrada');

    return prismaRead.ledgerEntry.findMany({
      where: { clubId, accountId },
      orderBy: { createdAt: 'asc' }
    });
  }

  async closeAccount(clubId: number, accountId: string) {
    return prisma.$transaction(async (tx) => {
      const account = await tx.account.findFirst({
        where: { id: accountId, clubId },
        include: { items: true, payments: true }
      });

      if (!account) throw new Error('Cuenta no encontrada');
      if (account.status !== 'OPEN') throw new Error('La cuenta no está abierta');

      const netPaid = await this.calculateNetPaidAmountTx(tx, account.id);
      const remaining = Number((Number(account.totalAmount || 0) - netPaid).toFixed(2));

      if (remaining > EPSILON) throw new Error('No se puede cerrar la cuenta: aún hay saldo pendiente');

      const closed = await tx.account.update({
        where: { id: accountId },
        data: {
          status: 'CLOSED',
          closedAt: new Date()
        }
      });

      await this.projectionService.refreshAccountSummary(accountId, tx);
      return closed;
    });
  }

  async addItem(clubId: number, accountId: string, input: {
    description: string;
    quantity: number;
    unitPrice: number;
    type?: 'BOOKING' | 'PRODUCT' | 'SERVICE' | 'ADJUSTMENT';
  }) {
    return prisma.$transaction(async (tx) => {
      const account = await tx.account.findFirst({ where: { id: accountId, clubId } });
      if (!account) throw new Error('Cuenta no encontrada');
      if (account.status !== 'OPEN') throw new Error('Solo se pueden agregar consumos a cuentas abiertas');
      if (account.sourceType === 'BOOKING') {
        const booking = await tx.booking.findFirst({
          where: { id: Number(account.sourceId), clubId },
          select: { status: true }
        });
        if (!booking) throw new Error('Reserva asociada a la cuenta no encontrada');
        if (booking.status === 'CANCELLED') {
          throw new Error('No se pueden agregar consumos a una reserva cancelada');
        }
        if (booking.status === 'COMPLETED') {
          throw new Error('No se pueden agregar consumos a una reserva completada');
        }
        if (booking.status !== 'CONFIRMED') {
          throw new Error('Solo se pueden agregar consumos a reservas confirmadas');
        }
      }

      const quantity = Math.floor(Number(input.quantity));
      const unitPrice = Number(input.unitPrice);
      const total = quantity * unitPrice;

      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Cantidad inválida');
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error('Precio unitario inválido');

      const item = await tx.accountItem.create({
        data: {
          accountId,
          type: input.type ?? 'PRODUCT',
          description: input.description,
          quantity,
          unitPrice: new Prisma.Decimal(unitPrice),
          total: new Prisma.Decimal(total)
        }
      });

      await tx.account.update({
        where: { id: accountId },
        data: {
          totalAmount: { increment: new Prisma.Decimal(total) }
        }
      });

      const revenueAccount = this.accountingService.mapRevenueAccount(input.type ?? 'PRODUCT');
      await this.accountingService.createAccountItemTransaction(tx, {
        clubId,
        type: 'ACCOUNT_ITEM',
        referenceType: 'ACCOUNT_ITEM',
        referenceId: item.id,
        accountId,
        accountItemId: item.id,
        amount: total,
        revenueAccount,
        description: input.description
      });

      await this.projectionService.refreshAccountSummary(accountId, tx);
      return item;
    });
  }
}

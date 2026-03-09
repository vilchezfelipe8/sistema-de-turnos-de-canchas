import { Prisma } from '@prisma/client';
import { prisma, prismaRead } from '../prisma';
import { AccountingService } from './AccountingService';
import { acquireTransactionAdvisoryLock } from '../utils/advisoryLock';
import { ProjectionService } from './ProjectionService';

const USE_PROJECTION_READ_MODELS = String(process.env.READ_MODEL_SOURCE || '').toLowerCase() === 'projection';

type OpenAccountInput = {
  clubId: number;
  sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL';
  sourceId: string;
};

export class AccountService {
  private readonly accountingService = new AccountingService();
  private readonly projectionService = new ProjectionService();

  async cancelItemsForSource(input: {
    sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL';
    sourceId: string | number;
  }) {
    const sourceId = String(input.sourceId);

    return prisma.$transaction(async (tx) => {
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
      const paid = Number(account.paidAmount || 0);
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
        payments: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getAccount(clubId: number, accountId: string) {
    const account = await prismaRead.account.findFirst({
      where: { id: accountId, clubId },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        payments: { orderBy: { createdAt: 'asc' } }
      }
    });

    if (!account) throw new Error('Cuenta no encontrada');

    const total = Number(account.totalAmount || 0);
    const paid = Number(account.paidAmount || 0);
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
          isBalanced: Math.abs(Number(projection.remaining || 0)) <= 0.009,
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
      isBalanced: Math.abs(balance.remaining) <= 0.009,
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
    const paid = Number(account.paidAmount || 0);

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

      const remaining = Number((Number(account.totalAmount || 0) - Number(account.paidAmount || 0)).toFixed(2));

      if (remaining > 0.009) throw new Error('No se puede cerrar la cuenta: aún hay saldo pendiente');

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

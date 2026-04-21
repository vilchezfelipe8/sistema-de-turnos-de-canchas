import { LedgerAccount, LedgerDirection, LedgerEntryType, LedgerReferenceType, PaymentChannel, PaymentMethod, Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

type BaseTransactionInput = {
  clubId: number;
  type: LedgerEntryType;
  referenceType: LedgerReferenceType;
  referenceId: string;
  createdByUserId?: number | null;
  description: string;
};

type AccountItemPostingInput = BaseTransactionInput & {
  accountId: string;
  accountItemId: string;
  amount: number;
  revenueAccount: LedgerAccount;
};

type PaymentPostingInput = BaseTransactionInput & {
  accountId: string;
  paymentId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentChannel?: PaymentChannel;
};

type RefundPostingInput = BaseTransactionInput & {
  accountId: string;
  refundId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentChannel?: PaymentChannel;
};

export class AccountingService {
  mapPaymentDebitAccount(method: PaymentMethod, channel: PaymentChannel = 'AUTO'): LedgerAccount {
    if (channel === 'CASH_DRAWER') return 'CASH';
    if (channel === 'CARD_TERMINAL') return 'CARD_CLEARING';
    if (channel === 'VIRTUAL_WALLET') return 'ONLINE_GATEWAY';
    if (channel === 'BANK_ACCOUNT') return 'BANK';
    if (method === 'CASH') return 'CASH';
    if (method === 'CARD') return 'CARD_CLEARING';
    return 'BANK';
  }

  mapRevenueAccount(type: 'BOOKING' | 'PRODUCT' | 'SERVICE' | 'ADJUSTMENT'): LedgerAccount {
    if (type === 'BOOKING') return 'BOOKING_REVENUE';
    if (type === 'PRODUCT') return 'BAR_REVENUE';
    return 'ADJUSTMENTS';
  }

  async createAccountItemTransaction(tx: TxClient, input: AccountItemPostingInput) {
    const transaction = await tx.ledgerTransaction.create({
      data: {
        clubId: input.clubId,
        type: input.type,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdByUserId: input.createdByUserId ?? null
      }
    });

    const amount = new Prisma.Decimal(input.amount);

    await tx.ledgerEntry.createMany({
      data: [
        {
          transactionId: transaction.id,
          clubId: input.clubId,
          type: input.type,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          accountId: input.accountId,
          accountItemId: input.accountItemId,
          amount,
          account: 'ACCOUNTS_RECEIVABLE',
          direction: 'DEBIT',
          description: input.description,
          createdByUserId: input.createdByUserId ?? null
        },
        {
          transactionId: transaction.id,
          clubId: input.clubId,
          type: input.type,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          accountId: input.accountId,
          accountItemId: input.accountItemId,
          amount,
          account: input.revenueAccount,
          direction: 'CREDIT',
          description: input.description,
          createdByUserId: input.createdByUserId ?? null
        }
      ]
    });

    return transaction;
  }

  async reverseAccountItemTransaction(tx: TxClient, input: AccountItemPostingInput) {
    const transaction = await tx.ledgerTransaction.create({
      data: {
        clubId: input.clubId,
        type: 'ADJUSTMENT',
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdByUserId: input.createdByUserId ?? null
      }
    });

    const amount = new Prisma.Decimal(Math.abs(input.amount));

    await tx.ledgerEntry.createMany({
      data: [
        {
          transactionId: transaction.id,
          clubId: input.clubId,
          type: 'ADJUSTMENT',
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          accountId: input.accountId,
          accountItemId: input.accountItemId,
          amount,
          account: input.revenueAccount,
          direction: 'DEBIT',
          description: input.description,
          createdByUserId: input.createdByUserId ?? null
        },
        {
          transactionId: transaction.id,
          clubId: input.clubId,
          type: 'ADJUSTMENT',
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          accountId: input.accountId,
          accountItemId: input.accountItemId,
          amount,
          account: 'ACCOUNTS_RECEIVABLE',
          direction: 'CREDIT',
          description: input.description,
          createdByUserId: input.createdByUserId ?? null
        }
      ]
    });

    return transaction;
  }

  async createPaymentTransaction(tx: TxClient, input: PaymentPostingInput) {
    const transaction = await tx.ledgerTransaction.create({
      data: {
        clubId: input.clubId,
        type: input.type,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdByUserId: input.createdByUserId ?? null
      }
    });

    const amount = new Prisma.Decimal(input.amount);
    const debitAccount = this.mapPaymentDebitAccount(input.paymentMethod, input.paymentChannel ?? 'AUTO');

    await tx.ledgerEntry.createMany({
      data: [
        {
          transactionId: transaction.id,
          clubId: input.clubId,
          type: input.type,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          accountId: input.accountId,
          paymentId: input.paymentId,
          amount,
          account: debitAccount,
          direction: 'DEBIT',
          description: input.description,
          createdByUserId: input.createdByUserId ?? null
        },
        {
          transactionId: transaction.id,
          clubId: input.clubId,
          type: input.type,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          accountId: input.accountId,
          paymentId: input.paymentId,
          amount,
          account: 'ACCOUNTS_RECEIVABLE',
          direction: 'CREDIT',
          description: input.description,
          createdByUserId: input.createdByUserId ?? null
        }
      ]
    });

    return transaction;
  }

  async createRefundTransaction(tx: TxClient, input: RefundPostingInput) {
    const transaction = await tx.ledgerTransaction.create({
      data: {
        clubId: input.clubId,
        type: 'REFUND',
        referenceType: 'REFUND',
        referenceId: input.refundId,
        createdByUserId: input.createdByUserId ?? null
      }
    });

    const amount = new Prisma.Decimal(Math.abs(input.amount));
    const creditAccount = this.mapPaymentDebitAccount(input.paymentMethod, input.paymentChannel ?? 'AUTO');

    await tx.ledgerEntry.createMany({
      data: [
        {
          transactionId: transaction.id,
          clubId: input.clubId,
          type: 'REFUND',
          referenceType: 'REFUND',
          referenceId: input.refundId,
          accountId: input.accountId,
          refundId: input.refundId,
          amount,
          account: 'ACCOUNTS_RECEIVABLE',
          direction: 'DEBIT',
          description: input.description,
          createdByUserId: input.createdByUserId ?? null
        },
        {
          transactionId: transaction.id,
          clubId: input.clubId,
          type: 'REFUND',
          referenceType: 'REFUND',
          referenceId: input.refundId,
          accountId: input.accountId,
          refundId: input.refundId,
          amount,
          account: creditAccount,
          direction: 'CREDIT',
          description: input.description,
          createdByUserId: input.createdByUserId ?? null
        }
      ]
    });

    return transaction;
  }

  async createCashDifferenceAdjustment(tx: TxClient, input: {
    clubId: number;
    referenceId: string;
    amount: number;
    description: string;
    createdByUserId?: number | null;
  }) {
    const absAmount = Math.abs(Number(input.amount));
    if (!Number.isFinite(absAmount) || absAmount <= 0.009) return null;

    const transaction = await tx.ledgerTransaction.create({
      data: {
        clubId: input.clubId,
        type: 'ADJUSTMENT',
        referenceType: 'MANUAL',
        referenceId: input.referenceId,
        createdByUserId: input.createdByUserId ?? null
      }
    });

    const amount = new Prisma.Decimal(absAmount);
    const debitAccount: LedgerAccount = input.amount > 0 ? 'CASH' : 'ADJUSTMENTS';
    const creditAccount: LedgerAccount = input.amount > 0 ? 'ADJUSTMENTS' : 'CASH';

    await tx.ledgerEntry.createMany({
      data: [
        {
          transactionId: transaction.id,
          clubId: input.clubId,
          type: 'ADJUSTMENT',
          referenceType: 'MANUAL',
          referenceId: input.referenceId,
          amount,
          account: debitAccount,
          direction: 'DEBIT',
          description: input.description,
          createdByUserId: input.createdByUserId ?? null
        },
        {
          transactionId: transaction.id,
          clubId: input.clubId,
          type: 'ADJUSTMENT',
          referenceType: 'MANUAL',
          referenceId: input.referenceId,
          amount,
          account: creditAccount,
          direction: 'CREDIT',
          description: input.description,
          createdByUserId: input.createdByUserId ?? null
        }
      ]
    });

    return transaction;
  }
}

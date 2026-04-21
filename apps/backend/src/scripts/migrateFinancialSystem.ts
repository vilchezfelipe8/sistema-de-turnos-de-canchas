import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

async function migrateFinancialSystem() {
  const accounts = await prisma.account.findMany({
    include: {
      items: true,
      payments: true,
      ledgerEntries: true
    }
  });

  for (const account of accounts) {
    await prisma.$transaction(async (tx) => {
      const existingDebitRefs = new Set(
        account.ledgerEntries
          .filter((entry) => entry.direction === 'DEBIT' && entry.accountItemId)
          .map((entry) => entry.accountItemId as string)
      );

      const existingCreditRefs = new Set(
        account.ledgerEntries
          .filter((entry) => entry.direction === 'CREDIT' && entry.paymentId)
          .map((entry) => entry.paymentId as string)
      );

      for (const item of account.items) {
        if (existingDebitRefs.has(item.id)) continue;

        const transaction = await tx.ledgerTransaction.create({
          data: {
            clubId: account.clubId,
            type: 'ACCOUNT_ITEM',
            referenceType: 'ACCOUNT_ITEM',
            referenceId: item.id,
            createdAt: item.createdAt
          }
        });

        await tx.ledgerEntry.create({
          data: {
            transactionId: transaction.id,
            clubId: account.clubId,
            type: 'ACCOUNT_ITEM',
            referenceType: 'ACCOUNT_ITEM',
            referenceId: item.id,
            accountId: account.id,
            accountItemId: item.id,
            amount: new Prisma.Decimal(item.total),
            account: 'ACCOUNTS_RECEIVABLE',
            direction: 'DEBIT',
            description: item.description,
            createdAt: item.createdAt
          }
        });
      }

      for (const payment of account.payments) {
        if (existingCreditRefs.has(payment.id)) continue;

        const transaction = await tx.ledgerTransaction.create({
          data: {
            clubId: account.clubId,
            type: 'PAYMENT',
            referenceType: 'PAYMENT',
            referenceId: payment.id,
            createdAt: payment.createdAt
          }
        });

        await tx.ledgerEntry.create({
          data: {
            transactionId: transaction.id,
            clubId: account.clubId,
            type: 'PAYMENT',
            referenceType: 'PAYMENT',
            referenceId: payment.id,
            accountId: account.id,
            paymentId: payment.id,
            amount: new Prisma.Decimal(payment.amount),
            account: 'ACCOUNTS_RECEIVABLE',
            direction: 'CREDIT',
            description: `Migración pago ${payment.method}`,
            createdAt: payment.createdAt
          }
        });
      }
    });
  }

  const validations = await Promise.all(
    accounts.map(async (account) => {
      const ledger = await prisma.ledgerEntry.findMany({ where: { accountId: account.id } });
      const debit = ledger
        .filter((entry) => entry.direction === 'DEBIT')
        .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      const credit = ledger
        .filter((entry) => entry.direction === 'CREDIT')
        .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      const balance = Number((debit - credit).toFixed(2));
      return { accountId: account.id, balance };
    })
  );

  const withDebt = validations.filter((validation) => validation.balance > 0.009);
  console.log(`Migración completada. Cuentas procesadas: ${accounts.length}. Con saldo pendiente: ${withDebt.length}`);
}

migrateFinancialSystem()
  .catch((error) => {
    console.error('Error en migrateFinancialSystem:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

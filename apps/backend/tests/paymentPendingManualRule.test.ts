import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentService } from '../src/services/PaymentService';
import { prisma } from '../src/prisma';

function buildPaymentServiceHarness() {
  const service = new PaymentService() as any;
  service.accountingService = {
    createPaymentTransaction: async () => null
  };
  service.eventService = {
    paymentReceived: async () => null
  };
  service.outboxService = {
    enqueue: async () => null
  };
  service.projectionService = {
    refreshAccountSummary: async () => null,
    refreshCashShiftSummary: async () => null,
    refreshDailyCashSummary: async () => null
  };
  return service as any;
}

test('PaymentService.create rejects PENDING booking payment in MANUAL mode', async () => {
  const service = buildPaymentServiceHarness();
  let paymentCreated = false;

  service.accountService = {
    reconcilePaidAmountTx: async () => ({ netPaid: 0 })
  } as any;
  service.bookingDomainService = {
    reevaluateBookingConfirmationTx: async () => null
  } as any;

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) => fn({
    payment: {
      findFirst: async () => null,
      create: async () => {
        paymentCreated = true;
        return { id: 'pay-1' };
      }
    },
    $queryRaw: async () => [{ id: 'acc-1', clubId: 10 }],
    account: {
      findUnique: async () => ({
        id: 'acc-1',
        clubId: 10,
        sourceType: 'BOOKING',
        sourceId: '91',
        status: 'OPEN',
        totalAmount: 38000,
        payments: [],
        items: []
      })
    },
    booking: {
      findUnique: async () => ({ id: 91, status: 'PENDING' })
    },
    clubSettings: {
      findUnique: async () => ({ bookingConfirmationMode: 'MANUAL' })
    }
  });

  try {
    await assert.rejects(
      () => service.create({
        clubId: 10,
        accountId: 'acc-1',
        amount: 1000,
        method: 'CASH',
        source: 'BACKOFFICE',
        idempotencyKey: 'manual-pending-block'
      }),
      (error: any) => {
        assert.equal(error?.code, 'BOOKING_PENDING_MANUAL_PAYMENT_FORBIDDEN');
        assert.match(String(error?.message || ''), /No se puede registrar un pago sobre una reserva pendiente en modo MANUAL/);
        return true;
      }
    );
    assert.equal(paymentCreated, false);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('PaymentService.create allows PENDING booking payment in DEPOSIT_REQUIRED mode and reevaluates confirmation', async () => {
  const service = buildPaymentServiceHarness();
  let reevaluated = false;

  service.accountService = {
    reconcilePaidAmountTx: async () => ({ netPaid: 0 })
  } as any;
  service.bookingDomainService = {
    reevaluateBookingConfirmationTx: async () => {
      reevaluated = true;
      return 'CONFIRMED';
    }
  } as any;

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) => fn({
    payment: {
      findFirst: async () => null,
      create: async () => ({
        id: 'pay-2',
        accountId: 'acc-2',
        amount: 6000,
        method: 'TRANSFER',
        channel: 'BANK_ACCOUNT',
        source: 'BACKOFFICE',
        createdAt: new Date('2026-03-23T12:00:00.000Z')
      }),
      findUnique: async () => ({
        id: 'pay-2',
        accountId: 'acc-2',
        amount: 6000,
        method: 'TRANSFER',
        channel: 'BANK_ACCOUNT',
        source: 'BACKOFFICE',
        allocations: []
      })
    },
    paymentAllocation: {
      groupBy: async () => [],
      createMany: async () => ({ count: 1 })
    },
    accountItem: {
      findMany: async () => ([
        {
          id: 'item-acc-2-1',
          total: 6000,
          createdAt: new Date('2026-03-23T11:00:00.000Z')
        }
      ])
    },
    $queryRaw: async () => [{ id: 'acc-2', clubId: 11 }],
    account: {
      findUnique: async () => ({
        id: 'acc-2',
        clubId: 11,
        sourceType: 'BOOKING',
        sourceId: '92',
        status: 'OPEN',
        totalAmount: 38000,
        payments: [],
        items: []
      })
    },
    booking: {
      findUnique: async (_args: any) => ({ id: 92, status: 'PENDING', userId: null })
    },
    clubSettings: {
      findUnique: async () => ({ bookingConfirmationMode: 'DEPOSIT_REQUIRED' })
    }
  });

  try {
    const payment = await service.create({
      clubId: 11,
      accountId: 'acc-2',
      amount: 6000,
      method: 'TRANSFER',
      channel: 'BANK_ACCOUNT',
      source: 'BACKOFFICE',
      idempotencyKey: 'deposit-required-allowed'
    });

    assert.equal(payment?.id, 'pay-2');
    assert.equal(reevaluated, true);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

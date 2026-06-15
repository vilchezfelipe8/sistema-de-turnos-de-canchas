import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentService } from '../src/services/PaymentService';

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
  service.bookingDomainService = {
    reevaluateBookingConfirmationTx: async () => null
  };
  return service as any;
}

test('PaymentService.createInTransaction rechaza cashShift de otro club y no crea payment', async () => {
  const service = buildPaymentServiceHarness();
  let paymentCreated = false;

  service.accountService = {
    reconcilePaidAmountTx: async () => ({ netPaid: 0 })
  };

  const tx = {
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
        sourceType: 'BAR',
        sourceId: 'bar-1',
        status: 'OPEN',
        totalAmount: 5000,
        payments: [],
        items: []
      })
    },
    cashShift: {
      findFirst: async () => null
    }
  } as any;

  await assert.rejects(
    () => service.createInTransaction(tx, {
      clubId: 10,
      accountId: 'acc-1',
      amount: 1000,
      method: 'CASH',
      source: 'POS',
      cashShiftId: 'shift-other-club'
    }),
    /turno de caja indicado no está abierto o no pertenece al club/
  );

  assert.equal(paymentCreated, false);
});

test('PaymentService.createInTransaction rechaza sobrepago y no crea payment', async () => {
  const service = buildPaymentServiceHarness();
  let paymentCreated = false;

  service.accountService = {
    reconcilePaidAmountTx: async () => ({ netPaid: 900 })
  };

  const tx = {
    payment: {
      findFirst: async () => null,
      create: async () => {
        paymentCreated = true;
        return { id: 'pay-2' };
      }
    },
    $queryRaw: async () => [{ id: 'acc-2', clubId: 11 }],
    account: {
      findUnique: async () => ({
        id: 'acc-2',
        clubId: 11,
        sourceType: 'MANUAL',
        sourceId: 'manual-1',
        status: 'OPEN',
        totalAmount: 1000,
        payments: [],
        items: []
      })
    }
  } as any;

  await assert.rejects(
    () => service.createInTransaction(tx, {
      clubId: 11,
      accountId: 'acc-2',
      amount: 200,
      method: 'TRANSFER',
      channel: 'BANK_ACCOUNT',
      source: 'BACKOFFICE'
    }),
    /supera el saldo pendiente/
  );

  assert.equal(paymentCreated, false);
});

test('PaymentService.createInTransaction con POS y caja abierta crea payment, cashShiftId y cashMovement', async () => {
  const service = buildPaymentServiceHarness();
  const createdPayments: any[] = [];
  const createdMovements: any[] = [];

  service.accountService = {
    reconcilePaidAmountTx: async () => ({ netPaid: 0 })
  };

  const tx = {
    payment: {
      findFirst: async () => null,
      create: async (args: any) => {
        createdPayments.push(args.data);
        return {
          id: 'pay-pos-1',
          createdAt: new Date('2026-05-12T12:00:00.000Z'),
          ...args.data
        };
      },
      findUnique: async () => ({
        id: 'pay-pos-1',
        createdAt: new Date('2026-05-12T12:00:00.000Z'),
        allocations: []
      })
    },
    paymentAllocation: {
      groupBy: async () => [],
      createMany: async () => ({ count: 1 })
    },
    cashMovement: {
      create: async (args: any) => {
        createdMovements.push(args.data);
        return { id: 'cm-pos-1', ...args.data };
      }
    },
    $queryRaw: async () => [{ id: 'acc-pos-1', clubId: 12 }],
    account: {
      findUnique: async () => ({
        id: 'acc-pos-1',
        clubId: 12,
        sourceType: 'BAR',
        sourceId: 'bar-1',
        status: 'OPEN',
        totalAmount: 5000,
        payments: [],
        items: []
      })
    },
    accountItem: {
      findMany: async () => ([
        { id: 'item-pos-1', total: 1000, createdAt: new Date('2026-05-12T11:00:00.000Z') }
      ])
    },
    cashShift: {
      findFirst: async () => ({ id: 'shift-open-1' })
    }
  } as any;

  const payment = await service.createInTransaction(tx, {
    clubId: 12,
    accountId: 'acc-pos-1',
    amount: 1000,
    method: 'CASH',
    source: 'POS'
  });

  assert.equal(payment?.id, 'pay-pos-1');
  assert.equal(createdPayments.length, 1);
  assert.equal(createdPayments[0].cashShiftId, 'shift-open-1');
  assert.equal(createdMovements.length, 1);
  assert.equal(createdMovements[0].cashShiftId, 'shift-open-1');
  assert.equal(Number(createdMovements[0].amount), 1000);
});

test('PaymentService.createInTransaction con POS sin caja abierta falla antes de crear payment', async () => {
  const service = buildPaymentServiceHarness();
  let paymentCreated = false;

  service.accountService = {
    reconcilePaidAmountTx: async () => ({ netPaid: 0 })
  };

  const tx = {
    payment: {
      findFirst: async () => null,
      create: async () => {
        paymentCreated = true;
        return { id: 'pay-pos-2' };
      }
    },
    paymentAllocation: {
      groupBy: async () => [],
      createMany: async () => ({ count: 1 })
    },
    cashMovement: {
      create: async () => ({ id: 'cm-pos-2' })
    },
    $queryRaw: async () => [{ id: 'acc-pos-2', clubId: 13 }],
    account: {
      findUnique: async () => ({
        id: 'acc-pos-2',
        clubId: 13,
        sourceType: 'BAR',
        sourceId: 'bar-2',
        status: 'OPEN',
        totalAmount: 5000,
        payments: [],
        items: []
      })
    },
    accountItem: {
      findMany: async () => ([
        { id: 'item-pos-2', total: 1000, createdAt: new Date('2026-05-12T11:00:00.000Z') }
      ])
    },
    cashShift: {
      findFirst: async () => null
    }
  } as any;

  await assert.rejects(
    () => service.createInTransaction(tx, {
      clubId: 13,
      accountId: 'acc-pos-2',
      amount: 1000,
      method: 'CASH',
      source: 'POS'
    }),
    /No hay turno de caja abierto para pagos POS/
  );

  assert.equal(paymentCreated, false);
});

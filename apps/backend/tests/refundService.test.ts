import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { RefundService } from '../src/services/RefundService';

type FakeState = {
  paymentAmount: number;
  paidAmount: number;
  source: 'POS' | 'ONLINE' | 'BACKOFFICE';
  method: 'CASH' | 'TRANSFER' | 'CARD' | 'MERCADO_PAGO' | 'OTHER';
  refunds: Array<{
    id: string;
    amount: number;
    status?: 'REQUESTED' | 'APPROVED' | 'READY_TO_EXECUTE' | 'EXECUTED' | 'FAILED' | 'CANCELLED';
    reason?: string | null;
    executionMethod?: 'CASH' | 'TRANSFER' | 'CARD_REVERSAL' | 'MP_REFUND' | 'CREDIT_NOTE' | 'OTHER' | null;
    paymentId?: string;
    accountId?: string;
    clubId?: number;
    createdByUserId?: number | null;
    cashShiftId?: string | null;
  }>;
  cashShiftOpen?: boolean;
};

function createHarness(state: FakeState) {
  const calls = {
    ledger: 0,
    cashMovement: 0
  };

  const tx: any = {
    $queryRaw: async () => [{ id: 'p1' }],
    auditLog: {
      create: async () => ({ id: 1 })
    },
    payment: {
      findUnique: async () => ({
        id: 'p1',
        amount: new Prisma.Decimal(state.paymentAmount),
        method: state.method,
        source: state.source,
        accountId: 'a1',
        account: {
          id: 'a1',
          clubId: 1,
          sourceType: 'BOOKING',
          sourceId: '11',
          status: 'OPEN',
          totalAmount: new Prisma.Decimal(20000),
          paidAmount: new Prisma.Decimal(state.paidAmount)
        },
        refunds: state.refunds.map((r) => ({
          id: r.id,
          amount: new Prisma.Decimal(r.amount),
          status: r.status ?? 'EXECUTED'
        }))
      })
    },
    cashShift: {
      findFirst: async () => (state.cashShiftOpen === false ? null : { id: 'shift1' })
    },
    account: {
      update: async ({ data }: any) => {
        state.paidAmount = Number(data.paidAmount ?? state.paidAmount);
        return { id: 'a1' };
      }
    },
    cashMovement: {
      create: async () => {
        calls.cashMovement += 1;
        return { id: 1 };
      }
    },
    booking: {
      findUnique: async () => ({ status: 'CANCELLED' })
    },
    refund: {
      create: async ({ data }: any) => {
        const id = `r${state.refunds.length + 1}`;
        const created = {
          id,
          amount: Number(data.amount),
          status: data.status ?? 'REQUESTED',
          reason: data.reason ?? null,
          executionMethod: data.executionMethod ?? null,
          paymentId: data.paymentId ?? 'p1',
          accountId: data.accountId ?? 'a1',
          clubId: data.clubId ?? 1,
          createdByUserId: data.createdByUserId ?? null,
          cashShiftId: data.cashShiftId ?? null
        };
        state.refunds.push(created);
        return {
          id,
          createdAt: new Date('2026-03-10T10:00:00Z'),
          amount: data.amount,
          reason: data.reason,
          status: data.status,
          executionMethod: data.executionMethod ?? null,
          paymentId: data.paymentId,
          accountId: data.accountId,
          clubId: data.clubId,
          cashShiftId: data.cashShiftId,
          createdByUserId: data.createdByUserId
        };
      },
      findUnique: async ({ where }: any) => {
        const found = state.refunds.find((r) => r.id === where.id);
        if (!found) return null;
        return {
          id: found.id,
          createdAt: new Date('2026-03-10T10:00:00Z'),
          amount: new Prisma.Decimal(found.amount),
          reason: found.reason ?? null,
          status: found.status ?? 'EXECUTED',
          executionMethod: found.executionMethod ?? null,
          paymentId: found.paymentId ?? 'p1',
          accountId: found.accountId ?? 'a1',
          clubId: found.clubId ?? 1,
          cashShiftId: found.cashShiftId ?? null,
          createdByUserId: found.createdByUserId ?? null,
          approvedByUserId: null,
          executedByUserId: null,
          executionReference: null,
          executionNotes: null,
          failedAt: null,
          failedReason: null,
          payment: {
            id: 'p1',
            method: state.method,
            source: state.source,
            account: {
              id: 'a1',
              clubId: 1
            }
          },
          cashMovement: null
        };
      },
      update: async ({ where, data }: any) => {
        const idx = state.refunds.findIndex((r) => r.id === where.id);
        if (idx === -1) throw new Error('Refund not found');
        state.refunds[idx] = {
          ...state.refunds[idx],
          ...('amount' in data ? { amount: Number(data.amount) } : {}),
          ...('status' in data ? { status: data.status } : {}),
          ...('reason' in data ? { reason: data.reason } : {}),
          ...('executionMethod' in data ? { executionMethod: data.executionMethod } : {}),
          ...('cashShiftId' in data ? { cashShiftId: data.cashShiftId } : {})
        };
        return { id: where.id };
      },
      aggregate: async () => ({ _sum: { amount: new Prisma.Decimal(0) } })
    }
  };

  const service = new RefundService();
  (service as any).accountingService = {
    createRefundTransaction: async () => {
      calls.ledger += 1;
      return { id: 'lt1' };
    }
  };
  (service as any).projectionService = {
    refreshAccountSummary: async () => null,
    refreshCashShiftSummary: async () => null,
    refreshDailyCashSummary: async () => null
  };
  (service as any).accountService = {
    reconcilePaidAmountTx: async (_tx: any, _accountId: string) => {
      const paid = Math.max(
        0,
        state.paymentAmount - state.refunds.reduce((sum, refund) => sum + refund.amount, 0)
      );
      state.paidAmount = Number(paid.toFixed(2));
      return {
        netPaid: state.paidAmount,
        total: 20000,
        remaining: Number((20000 - state.paidAmount).toFixed(2))
      };
    }
  };

  return { service, tx, state, calls };
}

test('refund total', async () => {
  const { service, tx, state, calls } = createHarness({
    paymentAmount: 20000,
    paidAmount: 20000,
    source: 'BACKOFFICE',
    method: 'TRANSFER',
    refunds: []
  });

  await service.refundPaymentTx(tx, { paymentId: 'p1', amount: 20000, clubId: 1, createdByUserId: 7 });

  assert.equal(state.paidAmount, 0);
  assert.equal(state.refunds.length, 1);
  assert.equal(state.refunds[0].amount, 20000);
  assert.equal(calls.ledger, 1);
});

test('refund parcial', async () => {
  const { service, tx, state } = createHarness({
    paymentAmount: 20000,
    paidAmount: 20000,
    source: 'BACKOFFICE',
    method: 'TRANSFER',
    refunds: []
  });

  await service.refundPaymentTx(tx, { paymentId: 'p1', amount: 5000, clubId: 1 });

  assert.equal(state.paidAmount, 15000);
  assert.equal(state.refunds[0].amount, 5000);
});

test('multiples refunds parciales sin exceder', async () => {
  const { service, tx, state } = createHarness({
    paymentAmount: 20000,
    paidAmount: 20000,
    source: 'BACKOFFICE',
    method: 'TRANSFER',
    refunds: []
  });

  await service.refundPaymentTx(tx, { paymentId: 'p1', amount: 5000, clubId: 1 });
  await service.refundPaymentTx(tx, { paymentId: 'p1', amount: 7000, clubId: 1 });

  assert.equal(state.refunds.length, 2);
  assert.equal(state.refunds[0].amount + state.refunds[1].amount, 12000);
});

test('bloquea refund por exceso', async () => {
  const { service, tx } = createHarness({
    paymentAmount: 20000,
    paidAmount: 20000,
    source: 'BACKOFFICE',
    method: 'TRANSFER',
    refunds: [{ id: 'r1', amount: 18000 }]
  });

  await assert.rejects(
    () => service.refundPaymentTx(tx, { paymentId: 'p1', amount: 3000, clubId: 1 }),
    /saldo refundable/
  );
});

test('refund genera ledger', async () => {
  const { service, tx, calls } = createHarness({
    paymentAmount: 10000,
    paidAmount: 10000,
    source: 'BACKOFFICE',
    method: 'TRANSFER',
    refunds: []
  });

  await service.refundPaymentTx(tx, { paymentId: 'p1', amount: 1000, clubId: 1 });
  assert.equal(calls.ledger, 1);
});

test('refund pos genera cash movement', async () => {
  const { service, tx, calls } = createHarness({
    paymentAmount: 10000,
    paidAmount: 10000,
    source: 'POS',
    method: 'CASH',
    refunds: [],
    cashShiftOpen: true
  });

  await service.refundPaymentTx(tx, { paymentId: 'p1', amount: 1200, clubId: 1 });
  assert.equal(calls.cashMovement, 1);
});

test('bloquea refund en cuenta cerrada no-cancelada', async () => {
  const { service, tx } = createHarness({
    paymentAmount: 10000,
    paidAmount: 10000,
    source: 'BACKOFFICE',
    method: 'TRANSFER',
    refunds: []
  });

  tx.payment.findUnique = async () => ({
    id: 'p1',
    amount: new Prisma.Decimal(10000),
    method: 'TRANSFER',
    source: 'BACKOFFICE',
    accountId: 'a1',
    account: {
      id: 'a1',
      clubId: 1,
      sourceType: 'MANUAL',
      sourceId: 'x1',
      status: 'CLOSED',
      totalAmount: new Prisma.Decimal(10000),
      paidAmount: new Prisma.Decimal(10000)
    },
    refunds: []
  });

  await assert.rejects(
    () => service.refundPaymentTx(tx, { paymentId: 'p1', amount: 1000, clubId: 1 }),
    /cuenta cerrada/
  );
});

test('refundBookingPaymentsTx usa solo saldo refundable remanente', async () => {
  const service = new RefundService() as any;
  const calls: Array<{ paymentId: string; amount: number }> = [];
  service.requestRefundTx = async (_tx: any, input: any) => {
    calls.push({ paymentId: input.paymentId, amount: input.amount });
    return { id: 'rx1' };
  };

  const tx: any = {
    $queryRaw: async () => [{ id: 'p1' }],
    account: {
      findFirst: async () => ({
        id: 'a1',
        payments: [{ id: 'p1', amount: new Prisma.Decimal(10000) }]
      })
    },
    payment: {
      findUnique: async () => ({
        id: 'p1',
        amount: new Prisma.Decimal(10000),
        method: 'TRANSFER',
        source: 'BACKOFFICE',
        accountId: 'a1',
        account: {
          id: 'a1',
          clubId: 1,
          sourceType: 'BOOKING',
          sourceId: '10',
          status: 'OPEN'
        },
        refunds: [{ id: 'r1', amount: new Prisma.Decimal(4000), status: 'EXECUTED' }]
      })
    }
  };

  await service.refundBookingPaymentsTx(tx, { bookingId: 10, clubId: 1, reason: 'cancel parcial' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].paymentId, 'p1');
  assert.equal(calls[0].amount, 6000);
});

test('requestRefund deja estado REQUESTED cuando no ejecuta', async () => {
  const { service, tx, state, calls } = createHarness({
    paymentAmount: 10000,
    paidAmount: 10000,
    source: 'BACKOFFICE',
    method: 'TRANSFER',
    refunds: []
  });

  const refund = await (service as any).requestRefundTx(tx, {
    paymentId: 'p1',
    amount: 1500,
    clubId: 1,
    executeNow: false,
    createdByUserId: 7
  });

  assert.equal(refund.status, 'REQUESTED');
  assert.equal(state.refunds.length, 1);
  assert.equal(calls.ledger, 0);
});

test('approve y execute de refund cash generan cash movement', async () => {
  const { service, tx, state, calls } = createHarness({
    paymentAmount: 10000,
    paidAmount: 10000,
    source: 'POS',
    method: 'CASH',
    refunds: []
  });

  const created = await (service as any).requestRefundTx(tx, {
    paymentId: 'p1',
    amount: 1200,
    clubId: 1,
    executeNow: false,
    createdByUserId: 9,
    executionMethod: 'CASH'
  });

  const approved = await (service as any).approveRefundTx(tx, {
    refundId: created.id,
    clubId: 1,
    approvedByUserId: 9,
    executeNow: true
  });

  assert.equal(approved.status, 'EXECUTED');
  assert.equal(calls.cashMovement, 1);
  assert.equal(state.paidAmount, 8800);
});

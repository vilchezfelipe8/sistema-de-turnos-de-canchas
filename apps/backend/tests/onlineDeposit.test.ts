import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { PendingBookingAutoCancelService } from '../src/services/PendingBookingAutoCancelService';
import { BookingService } from '../src/services/BookingService';

const withPrisma = async (patch: Record<string, any>, run: () => Promise<void>) => {
  const originals: Record<string, any> = {};
  for (const key of Object.keys(patch)) {
    originals[key] = (prisma as any)[key];
    (prisma as any)[key] = patch[key];
  }
  try {
    await run();
  } finally {
    for (const key of Object.keys(patch)) (prisma as any)[key] = originals[key];
  }
};

test('libera reservas con la seña vencida y respeta pagos de Mercado Pago en curso', async () => {
  const service = new PendingBookingAutoCancelService() as any;
  const cancelled: number[] = [];
  const statusById = new Map<number, string>([[1, 'PENDING'], [2, 'PENDING']]);
  service.bookingService = {
    cancelBooking: async (id: number, _by: null, _clubId: number, options: any) => {
      assert.equal(options.triggeredBy, 'SYSTEM');
      assert.equal(options.reason, 'ONLINE_DEPOSIT_EXPIRED');
      cancelled.push(id);
      statusById.set(id, 'CANCELLED');
    }
  };

  await withPrisma(
    {
      booking: {
        findMany: async (args: any) => {
          assert.equal(args.where.status, 'PENDING');
          assert.ok(args.where.onlineDepositDueAt.lte instanceof Date);
          return [{ id: 1, clubId: 7 }, { id: 2, clubId: 7 }];
        },
        findUnique: async (args: any) => ({ status: statusById.get(args.where.id) })
      },
      onlinePaymentAttempt: {
        // La reserva 2 tiene un pago iniciado recién: no se toca.
        findFirst: async (args: any) => (args.where.bookingId === 2 ? { id: 'attempt-2' } : null)
      }
    },
    async () => {
      const result = await service.processExpiredOnlineDepositHolds({ now: new Date('2026-11-05T20:00:00Z') });
      assert.deepEqual(result, { scanned: 2, cancelled: 1 });
    }
  );

  assert.deepEqual(cancelled, [1]);
});

test('la seña online cobra solo lo que falta, sobre la cancha y primero el lugar del titular', async () => {
  const service = Object.create(BookingService.prototype) as any;
  service.bookingDomainService = {
    getBookingFinancialSummaryTx: async () => ({ depositRequiredAmount: 3000, paid: 500 })
  };
  const tx: any = {
    clubSettings: {
      findUnique: async () => ({
        bookingConfirmationMode: 'DEPOSIT_REQUIRED',
        bookingDepositPercent: 30,
        onlineDepositRequired: true,
        onlineCheckoutEnabled: true
      })
    },
    bookingPlayerSlot: { findFirst: async () => ({ accountItemId: 'slot-owner' }) },
    paymentAllocation: { groupBy: async () => [{ accountItemId: 'slot-other', _sum: { amount: 500 } }] }
  };

  const target = await service.resolveDepositTargetTx(tx, {
    bookingId: 9,
    clubId: 7,
    bookingStatus: 'PENDING',
    accountId: 'acc-9',
    items: [
      { id: 'slot-other', type: 'BOOKING', total: 2500, createdAt: new Date('2026-11-01T10:00:00Z') },
      { id: 'slot-owner', type: 'BOOKING', total: 2500, createdAt: new Date('2026-11-01T10:01:00Z') },
      { id: 'agua', type: 'PRODUCT', total: 1800, createdAt: new Date('2026-11-01T09:00:00Z') }
    ],
    perPlayer: true,
    ownerRef: 'booking-client:c1',
    ownerName: 'Titular'
  });

  assert.equal(target.scope, 'DEPOSIT');
  assert.equal(target.blocked, null);
  assert.equal(target.amount, 2500);
  assert.deepEqual(target.items, [
    { accountItemId: 'slot-owner', amount: 2500 }
  ]);
  assert.equal(target.payer.ref, 'booking-client:c1');
});

test('sin modo seña o ya confirmada no hay seña para pagar', async () => {
  const service = Object.create(BookingService.prototype) as any;
  service.bookingDomainService = { getBookingFinancialSummaryTx: async () => ({ depositRequiredAmount: 3000, paid: 0 }) };
  const tx: any = { clubSettings: { findUnique: async () => ({ bookingConfirmationMode: 'AUTOMATIC' }) } };
  const target = await service.resolveDepositTargetTx(tx, {
    bookingId: 9, clubId: 7, bookingStatus: 'PENDING', accountId: 'acc-9', items: [], perPlayer: false, ownerRef: null, ownerName: null
  });
  assert.equal(target.blocked, 'DEPOSIT_NOT_REQUIRED');

  const confirmedTx: any = { clubSettings: { findUnique: async () => ({ bookingConfirmationMode: 'DEPOSIT_REQUIRED', bookingDepositPercent: 30 }) } };
  const confirmed = await service.resolveDepositTargetTx(confirmedTx, {
    bookingId: 9, clubId: 7, bookingStatus: 'CONFIRMED', accountId: 'acc-9', items: [], perPlayer: false, ownerRef: null, ownerName: null
  });
  assert.equal(confirmed.blocked, 'DEPOSIT_NOT_REQUIRED');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingService } from '../src/services/BookingService';
import { prisma } from '../src/prisma';
import { AppError, ErrorCodes } from '../src/errors';

function createService() {
  const service = new BookingService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any) as any;
  (service as any).accountService = {
    calculateNetPaidAmount: async () => 0
  };
  return service as any;
}

function baseBooking(overrides?: Partial<Record<string, any>>) {
  return {
    id: 701,
    displayCode: 'RES-701',
    startDateTime: new Date('2026-08-20T21:00:00.000Z'),
    endDateTime: new Date('2026-08-20T22:00:00.000Z'),
    status: 'CONFIRMED',
    userId: 77,
    clubId: 10,
    court: {
      id: 9,
      name: 'Cancha 1',
      club: {
        id: 10,
        name: 'Club Norte',
        slug: 'club-norte'
      }
    },
    client: {
      id: 'c-1',
      userId: null
    },
    participants: [],
    ...overrides
  };
}

function baseAccount(overrides?: Partial<Record<string, any>>) {
  return {
    id: 'acc-booking-701',
    status: 'OPEN',
    totalAmount: 8000,
    items: [
      {
        id: 'item-1',
        description: 'Reserva de cancha',
        quantity: 1,
        unitPrice: 8000,
        total: 8000,
        type: 'BOOKING'
      }
    ],
    refunds: [],
    ...overrides
  };
}

async function withPrismaMocks(
  mocks: Partial<Record<string, any>>,
  run: () => Promise<void>
) {
  const original = {
    bookingFindUnique: (prisma.booking as any).findUnique,
    accountFindFirst: (prisma.account as any).findFirst,
    paymentCreate: (prisma.payment as any).create,
    cashMovementCreate: (prisma.cashMovement as any).create
  };

  if (mocks.bookingFindUnique) (prisma.booking as any).findUnique = mocks.bookingFindUnique;
  if (mocks.accountFindFirst) (prisma.account as any).findFirst = mocks.accountFindFirst;
  if (mocks.paymentCreate) (prisma.payment as any).create = mocks.paymentCreate;
  if (mocks.cashMovementCreate) (prisma.cashMovement as any).create = mocks.cashMovementCreate;

  try {
    await run();
  } finally {
    (prisma.booking as any).findUnique = original.bookingFindUnique;
    (prisma.account as any).findFirst = original.accountFindFirst;
    (prisma.payment as any).create = original.paymentCreate;
    (prisma.cashMovement as any).create = original.cashMovementCreate;
  }
}

test('titular consulta checkout de su reserva y obtiene bloqueo por proveedor no configurado', async () => {
  const service = createService();
  (service as any).accountService.calculateNetPaidAmount = async () => 2500;

  await withPrismaMocks(
    {
      bookingFindUnique: async () => baseBooking(),
      accountFindFirst: async () => baseAccount()
    },
    async () => {
      const checkout = await service.getPlayerBookingCheckout(701, 77);

      assert.equal(checkout.booking.myRole, 'OWNER');
      assert.equal(checkout.account?.total, 8000);
      assert.equal(checkout.account?.paid, 2500);
      assert.equal(checkout.account?.pending, 5500);
      assert.equal(checkout.checkout.enabled, false);
      assert.equal(checkout.checkout.reason, 'PROVIDER_NOT_CONFIGURED');
      assert.equal(checkout.checkout.futureProvider, 'MERCADO_PAGO');
      assert.equal(checkout.paymentSummary.status, 'PARTIAL');
      assert.equal('payments' in (checkout.account as any), false);
      assert.equal('paymentAllocations' in (checkout.account as any), false);
    }
  );
});

test('participante consulta checkout pero no puede pagar todavía', async () => {
  const service = createService();
  (service as any).accountService.calculateNetPaidAmount = async () => 0;

  await withPrismaMocks(
    {
      bookingFindUnique: async () =>
        baseBooking({
          userId: 77,
          participants: [{ userId: 88, status: 'JOINED' }]
        }),
      accountFindFirst: async () => baseAccount()
    },
    async () => {
      const checkout = await service.getPlayerBookingCheckout(701, 88);
      assert.equal(checkout.booking.myRole, 'PARTICIPANT');
      assert.equal(checkout.checkout.enabled, false);
      assert.equal(checkout.checkout.reason, 'PARTICIPANT_PAYMENTS_NOT_SUPPORTED');
      assert.equal(checkout.paymentSummary.status, 'PENDING');
    }
  );
});

test('usuario ajeno no puede consultar checkout de otra reserva', async () => {
  const service = createService();

  await withPrismaMocks(
    {
      bookingFindUnique: async () => baseBooking({ userId: 77, client: { id: 'c-1', userId: null } })
    },
    async () => {
      await assert.rejects(
        () => service.getPlayerBookingCheckout(701, 99),
        (error: any) => error instanceof AppError && error.code === ErrorCodes.BOOKING_FORBIDDEN
      );
    }
  );
});

test('reserva sin Account BOOKING devuelve bloqueo por cuenta faltante', async () => {
  const service = createService();

  await withPrismaMocks(
    {
      bookingFindUnique: async () => baseBooking(),
      accountFindFirst: async () => null
    },
    async () => {
      const checkout = await service.getPlayerBookingCheckout(701, 77);
      assert.equal(checkout.account, null);
      assert.equal(checkout.checkout.reason, 'ACCOUNT_MISSING');
      assert.equal(checkout.paymentSummary.status, 'BLOCKED');
    }
  );
});

test('cuenta sin saldo pendiente devuelve no pending balance', async () => {
  const service = createService();
  (service as any).accountService.calculateNetPaidAmount = async () => 8000;

  await withPrismaMocks(
    {
      bookingFindUnique: async () => baseBooking(),
      accountFindFirst: async () => baseAccount({ status: 'CLOSED' })
    },
    async () => {
      const checkout = await service.getPlayerBookingCheckout(701, 77);
      assert.equal(checkout.checkout.reason, 'NO_PENDING_BALANCE');
      assert.equal(checkout.paymentSummary.status, 'PAID');
    }
  );
});

test('reserva con refunds queda bloqueada y el resumen no crea pagos ni movimientos', async () => {
  const service = createService();
  (service as any).accountService.calculateNetPaidAmount = async () => 3000;
  let paymentCreated = false;
  let cashMovementCreated = false;

  await withPrismaMocks(
    {
      bookingFindUnique: async () => baseBooking(),
      accountFindFirst: async () => baseAccount({
        refunds: [
          { id: 'ref-1', status: 'REQUESTED', amount: 1000 }
        ]
      }),
      paymentCreate: async () => {
        paymentCreated = true;
        return null;
      },
      cashMovementCreate: async () => {
        cashMovementCreated = true;
        return null;
      }
    },
    async () => {
      const checkout = await service.getPlayerBookingCheckout(701, 77);
      assert.equal(checkout.checkout.reason, 'BOOKING_HAS_REFUNDS');
      assert.equal(checkout.paymentSummary.status, 'BLOCKED');
      assert.equal(paymentCreated, false);
      assert.equal(cashMovementCreated, false);
    }
  );
});

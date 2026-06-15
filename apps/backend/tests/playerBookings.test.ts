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
    id: 101,
    displayCode: 'RES-101',
    startDateTime: new Date('2026-06-20T21:00:00.000Z'),
    endDateTime: new Date('2026-06-20T22:00:00.000Z'),
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
    activity: {
      id: 3,
      name: 'Fútbol'
    },
    client: {
      id: 'c-1',
      userId: null
    },
    ...overrides
  };
}

async function withPrismaMocks(
  mocks: {
    bookingFindMany?: any;
    bookingFindUnique?: any;
    accountFindMany?: any;
    accountFindFirst?: any;
  },
  run: () => Promise<void>
) {
  const original = {
    bookingFindMany: (prisma.booking as any).findMany,
    bookingFindUnique: (prisma.booking as any).findUnique,
    accountFindMany: (prisma.account as any).findMany,
    accountFindFirst: (prisma.account as any).findFirst
  };

  if (mocks.bookingFindMany) (prisma.booking as any).findMany = mocks.bookingFindMany;
  if (mocks.bookingFindUnique) (prisma.booking as any).findUnique = mocks.bookingFindUnique;
  if (mocks.accountFindMany) (prisma.account as any).findMany = mocks.accountFindMany;
  if (mocks.accountFindFirst) (prisma.account as any).findFirst = mocks.accountFindFirst;

  try {
    await run();
  } finally {
    (prisma.booking as any).findMany = original.bookingFindMany;
    (prisma.booking as any).findUnique = original.bookingFindUnique;
    (prisma.account as any).findMany = original.accountFindMany;
    (prisma.account as any).findFirst = original.accountFindFirst;
  }
}

test('titular explícito ve sus reservas por booking.userId y client.userId manual', async () => {
  const service = createService();
  (service as any).accountService.calculateNetPaidAmount = async (accountId: string) =>
    accountId === 'acc-booking-2' ? 2500 : 0;

  await withPrismaMocks(
    {
      bookingFindMany: async () => [
        baseBooking({ id: 101, userId: 77, client: { id: 'c-1', userId: null } }),
        baseBooking({ id: 102, userId: null, client: { id: 'c-2', userId: 77 } }),
        baseBooking({ id: 103, userId: 99, client: { id: 'c-3', userId: null } })
      ],
      accountFindMany: async () => [
        { id: 'acc-booking-1', sourceId: '101', totalAmount: 6000 },
        { id: 'acc-booking-2', sourceId: '102', totalAmount: 6000 }
      ]
    },
    async () => {
      const result = await service.getPlayerBookings(77);

      assert.equal(result.length, 2);
      assert.deepEqual(
        result.map((booking: any) => [booking.id, booking.myRole, booking.club.slug, booking.paymentSummary.status]),
        [
          ['101', 'OWNER', 'club-norte', 'PENDING'],
          ['102', 'OWNER', 'club-norte', 'PARTIAL']
        ]
      );
    }
  );
});

test('usuario ajeno no ve reservas y reservas históricas sin user explícito no aparecen', async () => {
  const service = createService();

  await withPrismaMocks(
    {
      bookingFindMany: async () => [
        baseBooking({ id: 201, userId: 99, client: { id: 'c-x', userId: null } }),
        baseBooking({ id: 202, userId: null, client: { id: 'c-y', userId: null } }),
        baseBooking({ id: 203, userId: 77, client: { id: 'c-z', userId: null } })
      ],
      accountFindMany: async () => []
    },
    async () => {
      const result = await service.getPlayerBookings(77);
      assert.equal(result.length, 1);
      assert.equal(result[0].id, '203');
    }
  );
});

test('el endpoint de Mis reservas usa un DTO público seguro', async () => {
  const service = createService();

  await withPrismaMocks(
    {
      bookingFindMany: async () => [baseBooking()],
      accountFindMany: async () => [{ id: 'acc-booking-1', sourceId: '101', totalAmount: 0 }]
    },
    async () => {
      const [dto] = await service.getPlayerBookings(77);
      assert.deepEqual(Object.keys(dto).sort(), [
        'activity',
        'capabilities',
        'club',
        'court',
        'endDateTime',
        'id',
        'myRole',
        'paymentSummary',
        'publicCode',
        'startDateTime',
        'status'
      ]);
      assert.equal('clientId' in (dto as any), false);
      assert.equal('price' in (dto as any), false);
      assert.equal('account' in (dto as any), false);
    }
  );
});

test('titular explícito puede cancelar una reserva futura sin pagos', async () => {
  const service = createService();
  let delegatedArgs: unknown[] = [];
  (service as any).cancelBooking = async (...args: unknown[]) => {
    delegatedArgs = args;
    return { id: 101, status: 'CANCELLED' } as any;
  };

  await withPrismaMocks(
    {
      bookingFindUnique: async () => baseBooking(),
      accountFindFirst: async () => ({ id: 'acc-booking-1' })
    },
    async () => {
      const result = await service.cancelPlayerBooking(101, 77);
      assert.equal((result as any).status, 'CANCELLED');
      assert.deepEqual(delegatedArgs, [
        101,
        77,
        undefined,
        {
          skipAccessValidation: true,
          reason: 'MANUAL',
          triggeredBy: 'USER'
        }
      ]);
    }
  );
});

test('participante implícito o usuario ajeno no puede cancelar una reserva', async () => {
  const service = createService();

  await withPrismaMocks(
    {
      bookingFindUnique: async () => baseBooking({ userId: 99, client: { id: 'c-1', userId: null } })
    },
    async () => {
      await assert.rejects(
        () => service.cancelPlayerBooking(101, 77),
        (error: any) => error instanceof AppError && error.code === ErrorCodes.BOOKING_FORBIDDEN
      );
    }
  );
});

test('reserva con pagos registrados bloquea cancelación pública', async () => {
  const service = createService();
  (service as any).accountService.calculateNetPaidAmount = async () => 1500;

  await withPrismaMocks(
    {
      bookingFindUnique: async () => baseBooking(),
      accountFindFirst: async () => ({ id: 'acc-booking-1' })
    },
    async () => {
      await assert.rejects(
        () => service.cancelPlayerBooking(101, 77),
        (error: any) => error instanceof AppError && error.code === ErrorCodes.BOOKING_HAS_PAYMENTS
      );
    }
  );
});

test('reserva pasada o completada no se puede cancelar desde jugador', async () => {
  const service = createService();

  await withPrismaMocks(
    {
      bookingFindUnique: async () =>
        baseBooking({
          startDateTime: new Date('2026-01-10T21:00:00.000Z'),
          endDateTime: new Date('2026-01-10T22:00:00.000Z')
        })
    },
    async () => {
      await assert.rejects(
        () => service.cancelPlayerBooking(101, 77),
        (error: any) => error instanceof AppError && error.code === ErrorCodes.BOOKING_CANCELLATION_NOT_ALLOWED
      );
    }
  );

  await withPrismaMocks(
    {
      bookingFindUnique: async () => baseBooking({ status: 'COMPLETED' })
    },
    async () => {
      await assert.rejects(
        () => service.cancelPlayerBooking(101, 77),
        (error: any) => error instanceof AppError && error.code === ErrorCodes.BOOKING_INVALID_STATUS
      );
    }
  );
});

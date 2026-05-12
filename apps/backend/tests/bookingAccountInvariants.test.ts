import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingService } from '../src/services/BookingService';
import { BookingDomainService } from '../src/services/BookingDomainService';
import { ClientDebtService } from '../src/services/ClientDebtService';
import { prisma } from '../src/prisma';

function buildBookingServiceHarness() {
  const service = new BookingService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

  (service as any).auditLogService = {
    create: async () => null
  };
  (service as any).eventService = {
    bookingConfirmed: async () => null,
    bookingCompleted: async () => null,
    bookingCancelled: async () => null
  };
  (service as any).getBookingById = async (bookingId: number) => ({ id: bookingId });

  return service as any;
}

test('confirmBooking creates booking account before status transition', async () => {
  const service = buildBookingServiceHarness();
  let ensured = false;

  service.ensureBookingAccountWithChargeTx = async () => {
    ensured = true;
    return { id: 'acc-1' };
  };

  service.bookingDomainService = {
    confirmBookingManuallyTx: async () => {
      assert.equal(ensured, true);
      return 'CONFIRMED';
    }
  };

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      booking: {
        findFirst: async () => ({
          id: 11,
          clubId: 2,
          price: 38000,
          activityId: 7,
          clientId: 'c1',
          status: 'PENDING'
        })
      }
    });

  try {
    await service.confirmBooking(11, 99, 2);
    assert.equal(ensured, true);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('confirmBooking rollback when account creation fails', async () => {
  const service = buildBookingServiceHarness();
  let confirmCalled = false;

  service.ensureBookingAccountWithChargeTx = async () => {
    throw new Error('fallo cuenta');
  };

  service.bookingDomainService = {
    confirmBookingManuallyTx: async () => {
      confirmCalled = true;
      return 'CONFIRMED';
    }
  };

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      booking: {
        findFirst: async () => ({
          id: 11,
          clubId: 2,
          price: 38000,
          activityId: 7,
          clientId: 'c1',
          status: 'PENDING'
        })
      }
    });

  try {
    await assert.rejects(() => service.confirmBooking(11, 99, 2), /fallo cuenta/);
    assert.equal(confirmCalled, false);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('completeBooking works only for confirmed booking with existing account', async () => {
  const service = buildBookingServiceHarness();
  let updated = false;
  let projectionRefreshed = false;

  service.projectionService = {
    refreshAccountSummary: async () => {
      projectionRefreshed = true;
    }
  };
  service.getBookingById = async () => ({ id: 77, status: 'COMPLETED' });

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      booking: {
        findFirst: async () => ({
          id: 77,
          clubId: 3,
          status: 'CONFIRMED',
          endDateTime: new Date('2026-03-01T10:00:00.000Z'),
          court: {},
          activity: {}
        }),
        update: async () => {
          updated = true;
          return { id: 77, status: 'COMPLETED' };
        }
      },
      account: {
        findFirst: async () => ({ id: 'acc-77' })
      }
    });

  try {
    const result = await service.completeBooking(77, 99, 3);
    assert.equal(updated, true);
    assert.equal(projectionRefreshed, true);
    assert.equal(result?.status, 'COMPLETED');
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('completeBooking fails with integrity error when confirmed booking has no account', async () => {
  const service = buildBookingServiceHarness();
  let updateCalled = false;

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      booking: {
        findFirst: async () => ({
          id: 88,
          clubId: 3,
          status: 'CONFIRMED',
          endDateTime: new Date('2026-03-01T10:00:00.000Z'),
          court: {},
          activity: {}
        }),
        update: async () => {
          updateCalled = true;
          return { id: 88, status: 'COMPLETED' };
        }
      },
      account: {
        findFirst: async () => null
      }
    });

  try {
    await assert.rejects(
      () => service.completeBooking(88, 99, 3),
      /Inconsistencia de integridad: la reserva 88 no tiene Account BOOKING/
    );
    assert.equal(updateCalled, false);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('completeBooking rejects pending bookings', async () => {
  const service = buildBookingServiceHarness();

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      booking: {
        findFirst: async () => ({
          id: 55,
          clubId: 3,
          status: 'PENDING',
          endDateTime: new Date('2026-03-01T10:00:00.000Z'),
          court: {},
          activity: {}
        })
      }
    });

  try {
    await assert.rejects(
      () => service.completeBooking(55, 99, 3),
      /Solo se puede completar una reserva confirmada/
    );
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('confirmBooking rejects cancelled/completed bookings', async () => {
  const service = buildBookingServiceHarness();
  service.ensureBookingAccountWithChargeTx = async () => ({ id: 'acc-x' });
  service.bookingDomainService = {
    confirmBookingManuallyTx: async () => 'CONFIRMED'
  };

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      booking: {
        findFirst: async () => ({
          id: 14,
          clubId: 2,
          price: 20000,
          activityId: 3,
          clientId: 'c1',
          status: 'CANCELLED'
        })
      }
    });

  try {
    await assert.rejects(
      () => service.confirmBooking(14, 99, 2),
      /Solo se puede confirmar una reserva pendiente/
    );
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('financial summary requires real booking account for confirmed/completed', async () => {
  const domain = new BookingDomainService();

  const tx: any = {
    booking: {
      findFirst: async () => ({
        id: 301,
        clubId: 40,
        price: 38000,
        status: 'CONFIRMED',
        startDateTime: new Date('2026-03-01T10:00:00.000Z')
      })
    },
    account: {
      findFirst: async () => null
    },
    clubSettings: {
      findUnique: async () => ({
        bookingConfirmationMode: 'MANUAL',
        bookingDepositPercent: null,
        allowManualConfirmationOverride: true,
        autoCancelPendingBookingsEnabled: false,
        autoCancelPendingBookingsMinutesBefore: null,
        autoCancelPendingBookingsOnlyIfUnpaid: true,
        autoCancelPendingWarningEnabled: false,
        autoCancelPendingWarningMinutesBefore: null
      })
    }
  };

  await assert.rejects(
    () => domain.getBookingFinancialSummaryTx(tx, 301, 40),
    /Inconsistencia de integridad: la reserva 301 está CONFIRMED pero no tiene Account BOOKING/
  );
});

test('completeExpiredConfirmedBookings only processes CONFIRMED bookings through completeBooking', async () => {
  const service = buildBookingServiceHarness();
  const completedCalls: Array<{ bookingId: number; clubId: number }> = [];

  service.completeBooking = async (bookingId: number, _actorUserId: number, clubId: number) => {
    completedCalls.push({ bookingId, clubId });
    return { id: bookingId, status: 'COMPLETED' };
  };

  const originalFindMany = (prisma as any).booking.findMany;
  (prisma as any).booking.findMany = async (args: any) => {
    assert.equal(args?.where?.status, 'CONFIRMED');
    assert.ok(args?.where?.endDateTime?.lte instanceof Date);
    return [
      { id: 401, clubId: 10 },
      { id: 402, clubId: 10 }
    ];
  };

  try {
    const result = await service.completeExpiredConfirmedBookings(new Date('2026-03-20T12:00:00.000Z'), 0);
    assert.equal(result.candidates, 2);
    assert.equal(result.completed, 2);
    assert.equal(result.failed.length, 0);
    assert.deepEqual(completedCalls, [
      { bookingId: 401, clubId: 10 },
      { bookingId: 402, clubId: 10 }
    ]);
  } finally {
    (prisma as any).booking.findMany = originalFindMany;
  }
});

test('completeExpiredConfirmedBookings records failures when completeBooking rejects (ex: missing account)', async () => {
  const service = buildBookingServiceHarness();
  let callCount = 0;

  service.completeBooking = async (bookingId: number) => {
    callCount += 1;
    if (bookingId === 502) {
      throw new Error('Inconsistencia de integridad: sin cuenta');
    }
    return { id: bookingId, status: 'COMPLETED' };
  };

  const originalFindMany = (prisma as any).booking.findMany;
  (prisma as any).booking.findMany = async () => [
    { id: 501, clubId: 11 },
    { id: 502, clubId: 11 }
  ];

  try {
    const result = await service.completeExpiredConfirmedBookings(new Date('2026-03-20T12:00:00.000Z'), 0);
    assert.equal(callCount, 2);
    assert.equal(result.completed, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0]?.bookingId, 502);
  } finally {
    (prisma as any).booking.findMany = originalFindMany;
  }
});

test('getBookingItems fails for CONFIRMED booking without account', async () => {
  const service = buildBookingServiceHarness();

  const originalBookingFindFirst = (prisma as any).booking.findFirst;
  const originalAccountFindFirst = (prisma as any).account.findFirst;
  (prisma as any).booking.findFirst = async () => ({ id: 610, status: 'CONFIRMED' });
  (prisma as any).account.findFirst = async () => null;

  try {
    await assert.rejects(
      () => service.getBookingItems(610, 7),
      /Inconsistencia de integridad: la reserva 610 está CONFIRMED pero no tiene Account BOOKING/
    );
  } finally {
    (prisma as any).booking.findFirst = originalBookingFindFirst;
    (prisma as any).account.findFirst = originalAccountFindFirst;
  }
});

test('getBookingItems tolerates missing account for PENDING booking', async () => {
  const service = buildBookingServiceHarness();

  const originalBookingFindFirst = (prisma as any).booking.findFirst;
  const originalAccountFindFirst = (prisma as any).account.findFirst;
  (prisma as any).booking.findFirst = async () => ({ id: 611, status: 'PENDING' });
  (prisma as any).account.findFirst = async () => null;

  try {
    const items = await service.getBookingItems(611, 7);
    assert.deepEqual(items, []);
  } finally {
    (prisma as any).booking.findFirst = originalBookingFindFirst;
    (prisma as any).account.findFirst = originalAccountFindFirst;
  }
});

test('cancelBooking allows PENDING without account', async () => {
  const service = buildBookingServiceHarness();
  let updateCalled = false;

  service.bookingRepo = {
    findById: async () => ({
      id: 710,
      status: 'PENDING',
      user: null,
      court: { id: 1, club: { id: 15, name: 'Club Test' } },
      activity: { id: 5 }
    })
  };
  service.eventService = { bookingCancelled: async () => null };
  service.outboxService = { enqueueMany: async () => null };
  service.auditLogService = { create: async () => null };
  service.buildBookingCancelledOutboxMessages = () => [];

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      $queryRaw: async () => [],
      booking: {
        findUnique: async () => ({
          id: 710,
          status: 'PENDING',
          startDateTime: new Date('2026-03-20T20:00:00.000Z'),
          court: { club: { id: 15, name: 'Club Test', settings: null } },
          activity: {},
          user: null,
          client: null
        }),
        update: async () => {
          updateCalled = true;
          return { id: 710, status: 'CANCELLED' };
        }
      },
      account: {
        findFirst: async () => null
      }
    });

  try {
    await service.cancelBooking(710, null, undefined, { skipAccessValidation: true });
    assert.equal(updateCalled, true);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('cancelBooking fails for CONFIRMED booking without account', async () => {
  const service = buildBookingServiceHarness();
  let updateCalled = false;

  service.bookingRepo = {
    findById: async () => ({
      id: 711,
      status: 'CONFIRMED',
      user: null,
      court: { id: 1, club: { id: 15, name: 'Club Test' } },
      activity: { id: 5 }
    })
  };
  service.eventService = { bookingCancelled: async () => null };
  service.outboxService = { enqueueMany: async () => null };
  service.auditLogService = { create: async () => null };
  service.buildBookingCancelledOutboxMessages = () => [];

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      $queryRaw: async () => [],
      booking: {
        findUnique: async () => ({
          id: 711,
          status: 'CONFIRMED',
          startDateTime: new Date('2026-03-20T20:00:00.000Z'),
          court: { club: { id: 15, name: 'Club Test', settings: null } },
          activity: {},
          user: null,
          client: null
        }),
        update: async () => {
          updateCalled = true;
          return { id: 711, status: 'CANCELLED' };
        }
      },
      account: {
        findFirst: async () => null
      }
    });

  try {
    await assert.rejects(
      () => service.cancelBooking(711, null, undefined, { skipAccessValidation: true }),
      /Inconsistencia de integridad: la reserva 711 está CONFIRMED pero no tiene Account BOOKING/
    );
    assert.equal(updateCalled, false);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('ClientDebtService.listByClub fails when confirmed/completed bookings have no account', async () => {
  const debtService = new ClientDebtService();

  const originalClientFindMany = (prisma as any).client.findMany;
  const originalAccountFindMany = (prisma as any).account.findMany;
  const originalBookingFindMany = (prisma as any).booking.findMany;

  (prisma as any).client.findMany = async () => [];
  (prisma as any).account.findMany = async () => [];
  (prisma as any).booking.findMany = async (args: any) => {
    if (args?.where?.status?.in) {
      return [{ id: 801, status: 'CONFIRMED' }];
    }
    return [];
  };

  try {
    await assert.rejects(
      () => debtService.listByClub(55),
      /Inconsistencia de integridad: hay reservas CONFIRMED\/COMPLETED sin Account BOOKING/
    );
  } finally {
    (prisma as any).client.findMany = originalClientFindMany;
    (prisma as any).account.findMany = originalAccountFindMany;
    (prisma as any).booking.findMany = originalBookingFindMany;
  }
});

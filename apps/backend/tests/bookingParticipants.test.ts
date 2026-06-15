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
    id: 501,
    displayCode: 'RES-501',
    startDateTime: new Date('2026-07-20T21:00:00.000Z'),
    endDateTime: new Date('2026-07-20T22:00:00.000Z'),
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
    participants: [],
    ...overrides
  };
}

async function withPrismaMocks(
  mocks: Partial<Record<string, any>>,
  run: () => Promise<void>
) {
  const original = {
    bookingFindMany: (prisma.booking as any).findMany,
    bookingFindUnique: (prisma.booking as any).findUnique,
    accountFindMany: (prisma.account as any).findMany,
    accountFindFirst: (prisma.account as any).findFirst,
    bookingParticipantFindMany: (prisma.bookingParticipant as any).findMany,
    bookingParticipantFindFirst: (prisma.bookingParticipant as any).findFirst,
    bookingParticipantFindUnique: (prisma.bookingParticipant as any).findUnique,
    userFindUnique: (prisma.user as any).findUnique,
    transaction: (prisma as any).$transaction
  };

  if (mocks.bookingFindMany) (prisma.booking as any).findMany = mocks.bookingFindMany;
  if (mocks.bookingFindUnique) (prisma.booking as any).findUnique = mocks.bookingFindUnique;
  if (mocks.accountFindMany) (prisma.account as any).findMany = mocks.accountFindMany;
  if (mocks.accountFindFirst) (prisma.account as any).findFirst = mocks.accountFindFirst;
  if (mocks.bookingParticipantFindMany) (prisma.bookingParticipant as any).findMany = mocks.bookingParticipantFindMany;
  if (mocks.bookingParticipantFindFirst) (prisma.bookingParticipant as any).findFirst = mocks.bookingParticipantFindFirst;
  if (mocks.bookingParticipantFindUnique) (prisma.bookingParticipant as any).findUnique = mocks.bookingParticipantFindUnique;
  if (mocks.userFindUnique) (prisma.user as any).findUnique = mocks.userFindUnique;
  if (mocks.transaction) (prisma as any).$transaction = mocks.transaction;

  try {
    await run();
  } finally {
    (prisma.booking as any).findMany = original.bookingFindMany;
    (prisma.booking as any).findUnique = original.bookingFindUnique;
    (prisma.account as any).findMany = original.accountFindMany;
    (prisma.account as any).findFirst = original.accountFindFirst;
    (prisma.bookingParticipant as any).findMany = original.bookingParticipantFindMany;
    (prisma.bookingParticipant as any).findFirst = original.bookingParticipantFindFirst;
    (prisma.bookingParticipant as any).findUnique = original.bookingParticipantFindUnique;
    (prisma.user as any).findUnique = original.userFindUnique;
    (prisma as any).$transaction = original.transaction;
  }
}

test('titular invita participante sin auto-linkear ni tocar titularidad', async () => {
  const service = createService();
  let createdData: any = null;
  let audited = false;

  await withPrismaMocks(
    {
      bookingFindUnique: async () => baseBooking({ participants: [] }),
      userFindUnique: async ({ where }: any) =>
        where?.id === 77 ? { email: 'owner@test.com' } : null,
      transaction: async (callback: any) => callback({
        bookingParticipant: {
          create: async ({ data }: any) => {
            createdData = data;
            return {
              id: 'bp-1',
              invitedEmail: data.invitedEmail,
              invitedName: data.invitedName,
              status: 'INVITED',
              user: null
            };
          }
        },
        auditLog: {
          create: async () => { audited = true; }
        }
      })
    },
    async () => {
      const participant = await service.invitePlayerBookingParticipant({
        bookingId: 501,
        ownerUserId: 77,
        invitedEmail: 'invite@test.com',
        invitedName: 'Beto'
      });

      assert.equal(participant.status, 'INVITED');
      assert.equal(participant.displayName, 'Beto');
      assert.equal(createdData.userId, undefined);
      assert.equal(createdData.bookingId, 501);
      assert.equal(createdData.invitedEmail, 'invite@test.com');
      assert.equal(audited, true);
    }
  );
});

test('invitado por email no ve la reserva hasta aceptar explícitamente', async () => {
  const service = createService();

  await withPrismaMocks(
    {
      bookingFindMany: async () => [
        baseBooking({
          userId: 99,
          client: { id: 'c-1', userId: null },
          participants: [{ id: 'bp-1', userId: null, status: 'INVITED' }]
        })
      ],
      accountFindMany: async () => []
    },
    async () => {
      const result = await service.getPlayerBookings(77);
      assert.equal(result.length, 0);
    }
  );
});

test('invitado acepta con email coincidente y luego ve la reserva como PARTICIPANT', async () => {
  const service = createService();
  let audited = false;

  await withPrismaMocks(
    {
      userFindUnique: async ({ where }: any) =>
        where?.id === 88 ? { email: 'invited@test.com' } : null,
      bookingParticipantFindUnique: async () => ({
        id: 'bp-1',
        bookingId: 501,
        invitedEmail: 'invited@test.com',
        status: 'INVITED',
        booking: baseBooking({
          userId: 77,
          client: { id: 'c-1', userId: null }
        })
      }),
      bookingParticipantFindFirst: async () => null,
      transaction: async (callback: any) => callback({
        bookingParticipant: {
          update: async ({ data }: any) => ({
            id: 'bp-1',
            bookingId: 501,
            userId: data.userId,
            status: data.status
          })
        },
        auditLog: {
          create: async () => { audited = true; }
        }
      }),
      bookingFindMany: async () => [
        baseBooking({
          userId: 77,
          client: { id: 'c-1', userId: null },
          participants: [{ id: 'bp-1', userId: 88, status: 'JOINED' }]
        })
      ],
      accountFindMany: async () => []
    },
    async () => {
      const accepted = await service.acceptBookingInvitation('bp-1', 88);
      assert.equal(accepted.status, 'JOINED');
      assert.equal(accepted.userId, 88);
      assert.equal(audited, true);

      const bookings = await service.getPlayerBookings(88);
      assert.equal(bookings.length, 1);
      assert.equal(bookings[0].myRole, 'PARTICIPANT');
      assert.equal(bookings[0].capabilities.canCancelBooking, false);
      assert.equal(bookings[0].capabilities.canLeaveBooking, true);
    }
  );
});

test('rechazar invitación la deja afuera de Mis reservas', async () => {
  const service = createService();

  await withPrismaMocks(
    {
      userFindUnique: async () => ({ email: 'invited@test.com' }),
      bookingParticipantFindUnique: async () => ({
        id: 'bp-1',
        invitedEmail: 'invited@test.com',
        status: 'INVITED',
        booking: {
          id: 501,
          clubId: 10,
          status: 'CONFIRMED',
          startDateTime: new Date('2026-07-20T21:00:00.000Z')
        }
      }),
      transaction: async (callback: any) => callback({
        bookingParticipant: { update: async () => ({ id: 'bp-1', status: 'DECLINED' }) },
        auditLog: { create: async () => ({}) }
      }),
      bookingFindMany: async () => [
        baseBooking({
          userId: 99,
          client: { id: 'c-1', userId: null },
          participants: [{ id: 'bp-1', userId: null, status: 'DECLINED' }]
        })
      ],
      accountFindMany: async () => []
    },
    async () => {
      await service.declineBookingInvitation('bp-1', 88);
      const result = await service.getPlayerBookings(88);
      assert.equal(result.length, 0);
    }
  );
});

test('usuario ajeno no puede aceptar invitación de otro email', async () => {
  const service = createService();

  await withPrismaMocks(
    {
      userFindUnique: async () => ({ email: 'otro@test.com' }),
      bookingParticipantFindUnique: async () => ({
        id: 'bp-1',
        invitedEmail: 'invite@test.com',
        status: 'INVITED',
        booking: baseBooking()
      })
    },
    async () => {
      await assert.rejects(
        () => service.acceptBookingInvitation('bp-1', 88),
        (error: any) => error instanceof AppError && error.code === ErrorCodes.BOOKING_INVITATION_EMAIL_MISMATCH
      );
    }
  );
});

test('titular ve la lista de participantes y participante sólo puede ver confirmados', async () => {
  const service = createService();
  const booking = baseBooking({
    participants: [
      { id: 'bp-1', userId: 88, invitedEmail: 'joined@test.com', invitedName: 'Lola', status: 'JOINED', user: { id: 88, firstName: 'Lola', lastName: 'Lopez', email: 'joined@test.com' } },
      { id: 'bp-2', userId: null, invitedEmail: 'pending@test.com', invitedName: 'Pepe', status: 'INVITED', user: null }
    ]
  });

  await withPrismaMocks(
    {
      bookingFindUnique: async () => booking
    },
    async () => {
      const ownerItems = await service.getPlayerBookingParticipants(501, 77);
      assert.equal(ownerItems.length, 2);
      assert.equal(ownerItems[1].invitedEmail, 'pending@test.com');

      const participantItems = await service.getPlayerBookingParticipants(501, 88);
      assert.equal(participantItems.length, 1);
      assert.equal(participantItems[0].displayName, 'Lola Lopez');
      assert.equal(participantItems[0].invitedEmail, null);
    }
  );
});

test('participante real no puede cancelar la reserva completa', async () => {
  const service = createService();

  await withPrismaMocks(
    {
      bookingFindUnique: async () =>
        baseBooking({
          userId: 77,
          client: { id: 'c-1', userId: null }
        })
    },
    async () => {
      await assert.rejects(
        () => service.cancelPlayerBooking(501, 88),
        (error: any) => error instanceof AppError && error.code === ErrorCodes.BOOKING_FORBIDDEN
      );
    }
  );
});

test('participante puede salirse si la reserva no empezó y luego deja de verla', async () => {
  const service = createService();
  let audited = false;

  await withPrismaMocks(
    {
      bookingParticipantFindFirst: async () => ({
        id: 'bp-1',
        booking: {
          id: 501,
          clubId: 10,
          status: 'CONFIRMED',
          startDateTime: new Date('2026-07-20T21:00:00.000Z')
        }
      }),
      transaction: async (callback: any) => callback({
        bookingParticipant: { update: async () => ({ id: 'bp-1', status: 'LEFT' }) },
        auditLog: { create: async () => { audited = true; } }
      }),
      bookingFindMany: async () => [
        baseBooking({
          userId: 77,
          client: { id: 'c-1', userId: null },
          participants: [{ id: 'bp-1', userId: 88, status: 'LEFT' }]
        })
      ],
      accountFindMany: async () => []
    },
    async () => {
      await service.leavePlayerBooking(501, 88);
      assert.equal(audited, true);
      const result = await service.getPlayerBookings(88);
      assert.equal(result.length, 0);
    }
  );
});

test('participante no puede salirse de una reserva ya empezada', async () => {
  const service = createService();

  await withPrismaMocks(
    {
      bookingParticipantFindFirst: async () => ({
        id: 'bp-1',
        booking: {
          id: 501,
          clubId: 10,
          status: 'CONFIRMED',
          startDateTime: new Date('2026-01-10T21:00:00.000Z')
        }
      })
    },
    async () => {
      await assert.rejects(
        () => service.leavePlayerBooking(501, 88),
        (error: any) => error instanceof AppError && error.code === ErrorCodes.BOOKING_CANNOT_LEAVE
      );
    }
  );
});

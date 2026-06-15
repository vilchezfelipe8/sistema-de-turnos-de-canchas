import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingService } from '../src/services/BookingService';
import { prisma } from '../src/prisma';

function buildServiceHarness() {
  const service = new BookingService(
    { mapToEntity: (input: any) => input } as any,
    {
      findById: async () => ({
        id: 10,
        name: 'Cancha 1',
        isUnderMaintenance: false,
        club: {
          id: 5,
          settings: {
            timeZone: 'America/Argentina/Buenos_Aires',
            openingDays: [0, 1, 2, 3, 4, 5, 6],
            closureDates: [],
            professorDurationOverrideEnabled: true,
            professorDurationOverrideMinutes: 60,
            allowManualConfirmationOverride: true,
            bookingConfirmationMode: 'MANUAL',
            lightsEnabled: false,
            bookingSimpleAdvanceDaysUser: 365,
            bookingSimpleAdvanceDaysAdmin: 365,
            allowAdminSkipSimpleAdvanceLimit: false,
            fixedBookingSettingsByActivity: {
              FUTBOL5: {
                fixedBookingDaysAhead: 1,
                fixedBookingGenerationFrequencyDays: 7
              }
            }
          }
        }
      })
    } as any,
    {
      findById: async (id: number) => ({
        id,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        phoneNumber: '+5493511234567'
      })
    } as any,
    {
      findById: async () => ({
        id: 20,
        name: 'Futbol 5',
        defaultDurationMinutes: 60,
        clubId: 5
      })
    } as any,
    {} as any,
    {} as any
  ) as any;

  service.resolveClientProfessorStatus = async () => false;
  return service;
}

type PrismaMocks = {
  fixedBookingFindMany: (args: any) => Promise<any[]>;
  transaction: (fn: (tx: any) => Promise<any>) => Promise<any>;
  clientFindFirst?: (args: any) => Promise<any>;
  userFindUnique?: (args: any) => Promise<any>;
};

function withPrismaMocks(mocks: PrismaMocks, run: () => Promise<void>) {
  const originalFixedFindMany = (prisma as any).fixedBooking.findMany;
  const originalTransaction = (prisma as any).$transaction;
  const originalClientFindFirst = (prisma as any).client.findFirst;
  const originalUserFindUnique = (prisma as any).user.findUnique;

  (prisma as any).fixedBooking.findMany = mocks.fixedBookingFindMany;
  (prisma as any).$transaction = mocks.transaction;
  if (mocks.clientFindFirst) {
    (prisma as any).client.findFirst = mocks.clientFindFirst;
  }
  if (mocks.userFindUnique) {
    (prisma as any).user.findUnique = mocks.userFindUnique;
  }

  return run().finally(() => {
    (prisma as any).fixedBooking.findMany = originalFixedFindMany;
    (prisma as any).$transaction = originalTransaction;
    (prisma as any).client.findFirst = originalClientFindFirst;
    (prisma as any).user.findUnique = originalUserFindUnique;
  });
}

test('no permite crear FixedBooking sin cliente', async () => {
  const service = buildServiceHarness();

  await assert.rejects(
    () => service.createFixedBooking(
      10,
      20,
      new Date('2026-04-15T13:00:00.000Z'),
      {
        durationMinutes: 60
      }
    ),
    /Debes seleccionar un cliente o cargar un alta rápida válida\./
  );
});

test('admin crea FixedBooking con clientId y genera bookings con ese clientId', async () => {
  const service = buildServiceHarness();
  const generatedClientIds: string[] = [];

  service.createBooking = async (
    _userId: number | null,
    _courtId: number,
    start: Date,
    _activityId: number,
    duration: number,
    _createdByAdmin: boolean,
    options?: any
  ) => {
    generatedClientIds.push(String(options?.clientId || ''));
    return {
      id: 501,
      startDateTime: start,
      endDateTime: new Date(start.getTime() + duration * 60000),
      status: 'PENDING',
      court: { name: 'Cancha 1' },
      activity: { name: 'Futbol 5' }
    };
  };

  await withPrismaMocks(
    {
      fixedBookingFindMany: async () => [],
      transaction: async (fn) => fn({
        client: {
          findFirst: async (args: any) => {
            if (args?.where?.id === 'client-1') {
              return { id: 'client-1', clubId: 5, name: 'Cliente 1', phone: '+5493511234567', userId: null };
            }
            return null;
          },
          findUnique: async () => null,
          update: async (args: any) => ({ id: args.where.id, ...args.data }),
          create: async (args: any) => ({ id: 'client-1', ...args.data })
        },
        user: {
          findUnique: async () => null
        },
        fixedBooking: {
          create: async () => ({ id: 77 })
        },
        booking: {
          findMany: async () => [],
          update: async () => ({ id: 501 })
        }
      }),
      clientFindFirst: async (args: any) => {
        if (args?.where?.id === 'client-1' && args?.where?.clubId === 5) {
          return { id: 'client-1', userId: null, phone: '+5493511234567' };
        }
        return null;
      }
    },
    async () => {
      const result = await service.createFixedBooking(
        10,
        20,
        new Date('2026-04-15T13:00:00.000Z'),
        {
          clientId: 'client-1',
          durationMinutes: 60,
          actorUserId: 9
        }
      );

      assert.equal(result.fixedBookingId, 77);
      assert.equal(result.clientId, 'client-1');
      assert.equal(generatedClientIds.length, 1);
      assert.equal(generatedClientIds[0], 'client-1');
    }
  );
});

test('admin puede crear Client rápido y luego FixedBooking', async () => {
  const service = buildServiceHarness();
  const generatedClientIds: string[] = [];

  service.createBooking = async (
    _userId: number | null,
    _courtId: number,
    start: Date,
    _activityId: number,
    duration: number,
    _createdByAdmin: boolean,
    options?: any
  ) => {
    generatedClientIds.push(String(options?.clientId || ''));
    return {
      id: 601,
      startDateTime: start,
      endDateTime: new Date(start.getTime() + duration * 60000),
      status: 'PENDING',
      court: { name: 'Cancha 1' },
      activity: { name: 'Futbol 5' }
    };
  };

  await withPrismaMocks(
    {
      fixedBookingFindMany: async () => [],
      transaction: async (fn) => fn({
        client: {
          findFirst: async () => null,
          findMany: async () => [],
          findUnique: async () => null,
          update: async (args: any) => ({ id: args.where.id, ...args.data }),
          create: async (args: any) => ({ id: 'client-new', ...args.data })
        },
        user: {
          findUnique: async () => null
        },
        fixedBooking: {
          create: async () => ({ id: 88 })
        },
        booking: {
          findMany: async () => [],
          update: async () => ({ id: 601 })
        }
      })
    },
    async () => {
      const result = await service.createFixedBooking(
        10,
        20,
        new Date('2026-04-15T13:00:00.000Z'),
        {
          clientDraft: {
            name: 'Cliente Nuevo',
            phone: '3511234567',
            email: 'cliente.nuevo@example.com',
            dni: '32123456'
          },
          durationMinutes: 60,
          actorUserId: 9
        }
      );

      assert.equal(result.fixedBookingId, 88);
      assert.equal(result.clientId, 'client-new');
      assert.equal(generatedClientIds.length, 1);
      assert.equal(generatedClientIds[0], 'client-new');
    }
  );
});

test('fixed booking con userId no auto-linkea Client.userId por coincidencia de email/teléfono', async () => {
  const service = buildServiceHarness();
  let createdClientData: any = null;
  let clientUpdateCalls = 0;
  const createBookingUserIds: Array<number | null> = [];

  service.createBooking = async (
    userId: number | null,
    _courtId: number,
    start: Date,
    _activityId: number,
    duration: number,
    _createdByAdmin: boolean,
    options?: any
  ) => {
    createBookingUserIds.push(userId);
    return {
      id: 701,
      startDateTime: start,
      endDateTime: new Date(start.getTime() + duration * 60000),
      status: 'PENDING',
      court: { name: 'Cancha 1' },
      activity: { name: 'Futbol 5' },
      clientId: options?.clientId || 'client-new-fixed'
    };
  };

  await withPrismaMocks(
    {
      fixedBookingFindMany: async () => [],
      transaction: async (fn) => fn({
        client: {
          findFirst: async (args: any) => {
            if (args?.where?.userId) return null;
            return null;
          },
          findMany: async (args: any) => {
            if (args?.where?.email === 'ada@example.com') {
              return [{ id: 'client-existing', clubId: 5, userId: null, email: 'ada@example.com', phone: '+5493511234567', createdAt: new Date('2026-05-19T20:00:00.000Z') }];
            }
            if (Array.isArray(args?.where?.phone?.in)) {
              return [{ id: 'client-existing', clubId: 5, userId: null, email: 'ada@example.com', phone: '+5493511234567', createdAt: new Date('2026-05-19T20:00:00.000Z') }];
            }
            return [];
          },
          findUnique: async () => null,
          update: async (args: any) => {
            clientUpdateCalls += 1;
            return { id: args.where.id, ...args.data };
          },
          create: async (args: any) => {
            createdClientData = args.data;
            return { id: 'client-new-fixed', ...args.data };
          }
        },
        user: {
          findUnique: async () => ({ dni: '30111222' })
        },
        fixedBooking: {
          create: async () => ({ id: 90 })
        },
        booking: {
          findMany: async () => [],
          update: async () => ({ id: 701 })
        }
      }),
      userFindUnique: async () => ({ dni: '30111222' })
    },
    async () => {
      const result = await service.createFixedBooking(
        10,
        20,
        new Date('2026-04-15T13:00:00.000Z'),
        {
          userId: 7,
          durationMinutes: 60,
          actorUserId: 9
        }
      );

      assert.equal(result.fixedBookingId, 90);
      assert.equal(result.clientId, 'client-existing');
      assert.equal(createdClientData, null);
      assert.equal(clientUpdateCalls, 0);
      assert.deepEqual(createBookingUserIds, [null]);
    }
  );
});

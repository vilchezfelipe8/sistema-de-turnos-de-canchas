import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingService } from '../src/services/BookingService';
import { prisma } from '../src/prisma';

type TxMock = {
  booking: {
    findMany: (args: any) => Promise<any[]>;
    create: (args: any) => Promise<any>;
    findUnique?: (args: any) => Promise<any>;
    update?: (args: any) => Promise<any>;
  };
  client: {
    findFirst: (args: any) => Promise<any>;
    findUnique: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
  };
  user: {
    findUnique: (args: any) => Promise<any>;
  };
  membership: {
    findMany: (args: any) => Promise<any[]>;
  };
};

function buildServiceHarness() {
  const bookingRepo = {
    mapToEntity: (input: any) => input
  };

  const service = new BookingService(
    bookingRepo as any,
    {
      findById: async () => ({
        id: 10,
        name: 'Cancha 1',
        isUnderMaintenance: false,
        club: {
          id: 5,
          name: 'Club Demo',
          phone: '+5493511234567',
          settings: {
            timeZone: 'America/Argentina/Buenos_Aires',
            openingDays: [0, 1, 2, 3, 4, 5, 6],
            closureDates: [],
            professorDurationOverrideEnabled: true,
            professorDurationOverrideMinutes: 60,
            allowManualConfirmationOverride: true,
            bookingConfirmationMode: 'MANUAL',
            lightsEnabled: false,
            allowAdminSkipSimpleAdvanceLimit: false,
            bookingSimpleAdvanceDaysUser: 365,
            bookingSimpleAdvanceDaysAdmin: 365
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
        clubId: 5,
        scheduleMode: 'FIXED',
        scheduleOpenTime: '08:00',
        scheduleCloseTime: '23:00',
        scheduleIntervalMinutes: 60,
        scheduleWindows: [],
        scheduleDurations: [60],
        scheduleFixedSlots: [{ start: '10:00', duration: 60 }]
      })
    } as any,
    {} as any,
    {} as any
  ) as any;

  service.resolveClientProfessorStatus = async () => false;
  service.resolveActivityScheduleForDate = async () => ({
    isClosed: false,
    schedule: {
      mode: 'FIXED',
      openTime: '08:00',
      closeTime: '23:00',
      intervalMinutes: 60,
      rangeWindows: [],
      durations: [60],
      fixedSlots: [{ start: '10:00', duration: 60 }]
    }
  });
  service.pricingService = {
    calculateCourtPrice: async () => 10000
  };
  service.eventService = {
    bookingCreated: async () => null
  };
  service.outboxService = {
    enqueueMany: async () => null
  };
  service.auditLogService = {
    create: async () => null
  };

  return service;
}

function withMockedTransaction(tx: TxMock, run: () => Promise<void>) {
  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) => fn(tx);
  return run().finally(() => {
    (prisma as any).$transaction = originalTransaction;
  });
}

test('no permite crear booking sin cliente en flujo sin usuario', async () => {
  const service = buildServiceHarness();

  await assert.rejects(
    () => service.createBooking(
      null,
      10,
      new Date('2026-04-10T13:00:00.000Z'),
      20,
      60,
      true,
      {}
    ),
    /Debes seleccionar un cliente o cargar un alta rápida válida\./
  );
});

test('usuario autenticado crea booking con clientId resuelto', async () => {
  const service = buildServiceHarness();
  let createdData: any = null;

  const tx: TxMock = {
    booking: {
      findMany: async () => [],
      create: async (args: any) => {
        createdData = args.data;
        return {
          id: 901,
          ...args.data,
          user: null,
          client: { id: args.data.clientId, name: 'Ada Lovelace', phone: '+5493511234567', email: 'ada@example.com', dni: '30111222' },
          court: {
            id: 10,
            name: 'Cancha 1',
            isIndoor: false,
            surface: 'cemento',
            isUnderMaintenance: false,
            club: {
              id: 5,
              slug: 'club-demo',
              name: 'Club Demo',
              addressLine: 'Calle 123',
              city: 'Cordoba',
              province: 'Cordoba',
              country: 'AR',
              contactInfo: 'contacto',
              phone: '+5493511234567',
              settings: {
                timeZone: 'America/Argentina/Buenos_Aires',
                openingDays: [0, 1, 2, 3, 4, 5, 6],
                closureDates: [],
                professorDurationOverrideEnabled: true,
                professorDurationOverrideMinutes: 60,
                allowManualConfirmationOverride: true,
                bookingConfirmationMode: 'MANUAL',
                lightsEnabled: false,
                allowAdminSkipSimpleAdvanceLimit: false,
                bookingSimpleAdvanceDaysUser: 365,
                bookingSimpleAdvanceDaysAdmin: 365
              }
            }
          },
          activity: {
            id: 20,
            name: 'Futbol 5',
            description: 'Partido',
            defaultDurationMinutes: 60,
            clubId: 5,
            scheduleMode: 'FIXED',
            scheduleOpenTime: '08:00',
            scheduleCloseTime: '23:00',
            scheduleIntervalMinutes: 60,
            scheduleWindows: [],
            scheduleDurations: [60],
            scheduleFixedSlots: [{ start: '10:00', duration: 60 }]
          }
        };
      }
    },
    client: {
      findFirst: async (args: any) => {
        if (args?.where?.userId) {
          return { id: 'client-user', name: 'Ada Lovelace', phone: '+5493511234567', email: 'ada@example.com', dni: '30111222', userId: 7 };
        }
        return null;
      },
      findUnique: async () => null,
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      create: async (args: any) => ({ id: 'client-user', ...args.data })
    },
    user: {
      findUnique: async () => ({ dni: '30111222' })
    },
    membership: {
      findMany: async () => []
    }
  };

  await withMockedTransaction(tx, async () => {
    const result = await service.createBooking(
      7,
      10,
      new Date('2026-04-10T13:00:00.000Z'),
      20,
      60,
      false,
      {}
    );

    assert.equal(result.id, 901);
    assert.equal(createdData.clientId, 'client-user');
  });
});

test('admin crea booking con clientId explícito', async () => {
  const service = buildServiceHarness();
  let createdData: any = null;

  const tx: TxMock = {
    booking: {
      findMany: async () => [],
      create: async (args: any) => {
        createdData = args.data;
        return {
          id: 902,
          ...args.data,
          user: null,
          client: { id: args.data.clientId, name: 'Cliente Admin', phone: '+5493517654321', email: null, dni: null },
          court: {
            id: 10,
            name: 'Cancha 1',
            isIndoor: false,
            surface: 'cemento',
            isUnderMaintenance: false,
            club: {
              id: 5,
              slug: 'club-demo',
              name: 'Club Demo',
              addressLine: 'Calle 123',
              city: 'Cordoba',
              province: 'Cordoba',
              country: 'AR',
              contactInfo: 'contacto',
              phone: '+5493511234567',
              settings: {
                timeZone: 'America/Argentina/Buenos_Aires',
                openingDays: [0, 1, 2, 3, 4, 5, 6],
                closureDates: [],
                professorDurationOverrideEnabled: true,
                professorDurationOverrideMinutes: 60,
                allowManualConfirmationOverride: true,
                bookingConfirmationMode: 'MANUAL',
                lightsEnabled: false,
                allowAdminSkipSimpleAdvanceLimit: false,
                bookingSimpleAdvanceDaysUser: 365,
                bookingSimpleAdvanceDaysAdmin: 365
              }
            }
          },
          activity: {
            id: 20,
            name: 'Futbol 5',
            description: 'Partido',
            defaultDurationMinutes: 60,
            clubId: 5,
            scheduleMode: 'FIXED',
            scheduleOpenTime: '08:00',
            scheduleCloseTime: '23:00',
            scheduleIntervalMinutes: 60,
            scheduleWindows: [],
            scheduleDurations: [60],
            scheduleFixedSlots: [{ start: '10:00', duration: 60 }]
          }
        };
      }
    },
    client: {
      findFirst: async (args: any) => {
        if (args?.where?.id === 'client-admin') {
          return { id: 'client-admin', clubId: 5, name: 'Cliente Admin', phone: '+5493517654321' };
        }
        return null;
      },
      findUnique: async () => null,
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      create: async (args: any) => ({ id: 'client-admin', ...args.data })
    },
    user: {
      findUnique: async () => null
    },
    membership: {
      findMany: async () => []
    }
  };

  await withMockedTransaction(tx, async () => {
    const result = await service.createBooking(
      null,
      10,
      new Date('2026-04-10T13:00:00.000Z'),
      20,
      60,
      true,
      { clientId: 'client-admin' }
    );

    assert.equal(result.id, 902);
    assert.equal(createdData.clientId, 'client-admin');
  });
});

test('alta rápida sin teléfono falla explícitamente', async () => {
  const service = buildServiceHarness();

  await assert.rejects(
    () => service.createBooking(
      null,
      10,
      new Date('2026-04-10T13:00:00.000Z'),
      20,
      60,
      true,
      {
        clientDraft: {
          name: 'Cliente Sin Tel'
        }
      }
    ),
    /El teléfono es obligatorio para el alta rápida de cliente\./
  );
});

test('booking matchea por teléfono canónico aunque alta rápida llegue en formato local', async () => {
  const service = buildServiceHarness();
  let createdData: any = null;
  let seenPhoneWhere: string | null = null;

  const tx: TxMock = {
    booking: {
      findMany: async () => [],
      create: async (args: any) => {
        createdData = args.data;
        return {
          id: 903,
          ...args.data,
          user: null,
          client: { id: args.data.clientId, name: 'Cliente Canonico', phone: '+5493511234567', email: null, dni: null },
          court: {
            id: 10,
            name: 'Cancha 1',
            isIndoor: false,
            surface: 'cemento',
            isUnderMaintenance: false,
            club: {
              id: 5,
              slug: 'club-demo',
              name: 'Club Demo',
              addressLine: 'Calle 123',
              city: 'Cordoba',
              province: 'Cordoba',
              country: 'AR',
              contactInfo: 'contacto',
              phone: '+5493511234567',
              settings: {
                timeZone: 'America/Argentina/Buenos_Aires',
                openingDays: [0, 1, 2, 3, 4, 5, 6],
                closureDates: [],
                professorDurationOverrideEnabled: true,
                professorDurationOverrideMinutes: 60,
                allowManualConfirmationOverride: true,
                bookingConfirmationMode: 'MANUAL',
                lightsEnabled: false,
                allowAdminSkipSimpleAdvanceLimit: false,
                bookingSimpleAdvanceDaysUser: 365,
                bookingSimpleAdvanceDaysAdmin: 365
              }
            }
          },
          activity: {
            id: 20,
            name: 'Futbol 5',
            description: 'Partido',
            defaultDurationMinutes: 60,
            clubId: 5,
            scheduleMode: 'FIXED',
            scheduleOpenTime: '08:00',
            scheduleCloseTime: '23:00',
            scheduleIntervalMinutes: 60,
            scheduleWindows: [],
            scheduleDurations: [60],
            scheduleFixedSlots: [{ start: '10:00', duration: 60 }]
          }
        };
      }
    },
    client: {
      findFirst: async (args: any) => {
        if (Array.isArray(args?.where?.phone?.in)) {
          seenPhoneWhere = String(args.where.phone.in[0] || '');
          return { id: 'client-canonical', clubId: 5, name: 'Cliente Canonico', phone: '+5493511234567' };
        }
        return null;
      },
      findUnique: async (args: any) => {
        if (args?.where?.id === 'client-canonical') {
          return { id: 'client-canonical', clubId: 5, name: 'Cliente Canonico', phone: '+5493511234567', userId: null };
        }
        return null;
      },
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      create: async (args: any) => ({ id: 'client-new', ...args.data })
    },
    user: {
      findUnique: async () => null
    },
    membership: {
      findMany: async () => []
    }
  };

  await withMockedTransaction(tx, async () => {
    const result = await service.createBooking(
      null,
      10,
      new Date('2026-04-10T13:00:00.000Z'),
      20,
      60,
      true,
      {
        clientDraft: {
          name: 'Cliente Local',
          phone: '+54 9 351 123-4567'
        }
      }
    );

    assert.equal(result.id, 903);
    assert.equal(createdData.clientId, 'client-canonical');
    assert.equal(seenPhoneWhere, '+5493511234567');
  });
});

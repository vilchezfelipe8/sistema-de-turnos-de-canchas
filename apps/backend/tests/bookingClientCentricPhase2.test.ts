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
    findMany?: (args: any) => Promise<any[]>;
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
  bookingBillingConfig: {
    upsert: (args: any) => Promise<any>;
  };
  bookingParticipant: {
    findFirst: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
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
    bookingCreated: async () => null,
    bookingParticipantAdded: async () => null
  };
  service.bookingHistoryService = {
    appendBookingHistoryEntryTx: async () => null
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

function createBookingParticipantRepo(state?: {
  existingOrganizer?: any;
  created?: any[];
  updated?: Array<{ where: any; data: any }>;
}) {
  return {
    findFirst: async ({ where }: any) => {
      if (where?.role === 'ORGANIZER') {
        return state?.existingOrganizer ?? null;
      }
      return null;
    },
    create: async ({ data }: any) => {
      state?.created?.push(data);
      return { id: 'bp-org-created', ...data };
    },
    update: async ({ where, data }: any) => {
      state?.updated?.push({ where, data });
      return { id: where?.id ?? 'bp-org-updated', ...data };
    }
  };
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
  const organizerCreates: any[] = [];
  const historyEntries: any[] = [];

  service.bookingHistoryService = {
    appendBookingHistoryEntryTx: async (_tx: any, input: any) => {
      historyEntries.push(input);
      return { id: `bhe-${historyEntries.length}`, ...input };
    }
  };

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
      findMany: async () => [],
      findUnique: async () => null,
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      create: async (args: any) => ({ id: 'client-user', ...args.data })
    },
    user: {
      findUnique: async () => ({ dni: '30111222' })
    },
    membership: {
      findMany: async () => []
    },
    bookingBillingConfig: {
      upsert: async () => ({ id: 'cfg-901' })
    },
    bookingParticipant: createBookingParticipantRepo({ created: organizerCreates })
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
    assert.equal(organizerCreates.length, 1);
    assert.equal(organizerCreates[0].role, 'ORGANIZER');
    assert.equal(organizerCreates[0].clientId, 'client-user');
    assert.equal(organizerCreates[0].userId, 7);
    assert.equal(historyEntries.length, 1);
    assert.equal(historyEntries[0].action, 'BOOKING_CREATED');
  });
});

test('reserva pública con usuario logueado conserva Booking.userId y no auto-linkea Client.userId', async () => {
  const service = buildServiceHarness();
  let createdBookingData: any = null;
  let createdClientData: any = null;
  let clientUpdateCalls = 0;
  const organizerCreates: any[] = [];

  const tx: TxMock = {
    booking: {
      findMany: async () => [],
      create: async (args: any) => {
        createdBookingData = args.data;
        return {
          id: 905,
          ...args.data,
          user: null,
          client: { id: args.data.clientId, name: 'Ada', phone: args.data.phone ?? null, email: args.data.email ?? null, dni: args.data.dni ?? null, userId: null },
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
        if (args?.where?.userId) return null;
        return null;
      },
      findMany: async (args: any) => {
        if (args?.where?.email === 'ada@example.com') {
          return [{ id: 'client-preexisting', clubId: 5, name: 'Ada Preexisting', userId: null, email: 'ada@example.com', phone: '+5493511234567', createdAt: new Date('2026-05-19T20:00:00.000Z') }];
        }
        if (Array.isArray(args?.where?.phone?.in)) {
          return [{ id: 'client-preexisting', clubId: 5, name: 'Ada Preexisting', userId: null, email: 'ada@example.com', phone: '+5493511234567', createdAt: new Date('2026-05-19T20:00:00.000Z') }];
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
        return { id: 'client-new-public', ...args.data };
      }
    },
    user: {
      findUnique: async () => ({ dni: '30111222' })
    },
    membership: {
      findMany: async () => []
    },
    bookingBillingConfig: {
      upsert: async () => ({ id: 'cfg-905' })
    },
    bookingParticipant: createBookingParticipantRepo({ created: organizerCreates })
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

    assert.equal(result.id, 905);
    assert.equal(createdBookingData.userId, 7);
    assert.equal(createdBookingData.clientId, 'client-preexisting');
    assert.equal(createdClientData, null);
    assert.equal(clientUpdateCalls, 0);
    assert.equal(organizerCreates.length, 1);
    assert.equal(organizerCreates[0].clientId, 'client-preexisting');
    assert.equal(organizerCreates[0].userId, 7);
  });
});

test('admin crea booking con clientId explícito', async () => {
  const service = buildServiceHarness();
  let createdData: any = null;
  const organizerCreates: any[] = [];

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
    },
    bookingBillingConfig: {
      upsert: async () => ({ id: 'cfg-902' })
    },
    bookingParticipant: createBookingParticipantRepo({ created: organizerCreates })
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
    assert.equal(organizerCreates.length, 1);
    assert.equal(organizerCreates[0].clientId, 'client-admin');
    assert.equal(organizerCreates[0].userId, null);
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

test('booking admin reutiliza client existente por identidad fuerte y no crea duplicado', async () => {
  const service = buildServiceHarness();
  let seenPhoneWhere: string | null = null;
  let createdData: any = null;

  const tx: TxMock = {
    booking: {
      findMany: async () => [],
      create: async (args: any) => {
        createdData = args.data;
        return {
          id: 903,
          ...args.data,
          user: null,
          client: { id: args.data.clientId, name: 'Cliente Canonico', phone: '+5493511234567', email: 'cliente.local@example.com', dni: null },
          court: { id: 10, name: 'Cancha 1', isIndoor: false, surface: 'cemento', isUnderMaintenance: false, club: { id: 5, slug: 'club-demo', name: 'Club Demo', addressLine: 'Calle 123', city: 'Cordoba', phone: '+5493511234567' } },
          activityType: { id: 20, name: 'Futbol 5' }
        };
      }
    },
    client: {
      findFirst: async (args: any) => {
        if (Array.isArray(args?.where?.phone?.in)) {
          seenPhoneWhere = String(args.where.phone.in[0] || '');
        }
        return null;
      },
      findMany: async (args: any) => {
        if (Array.isArray(args?.where?.phone?.in)) {
          seenPhoneWhere = String(args.where.phone.in[0] || '');
          return [{ id: 'client-canonical', clubId: 5, name: 'Cliente Canonico', phone: '+5493511234567', userId: null, createdAt: new Date('2026-05-19T21:02:15.000Z') }];
        }
        if (args?.where?.email) {
          return [];
        }
        if (args?.where?.dni) {
          return [];
        }
        return [];
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
    },
    bookingBillingConfig: {
      upsert: async () => ({ id: 'cfg-903' })
    },
    bookingParticipant: createBookingParticipantRepo()
  };

  await withMockedTransaction(tx, async () => {
    const booking = await service.createBooking(
      null,
      10,
      new Date('2026-04-10T13:00:00.000Z'),
      20,
      60,
      true,
      {
        clientDraft: {
          name: 'Cliente Local',
          phone: '+54 9 351 123-4567',
          email: 'cliente.local@example.com'
        }
      }
    );

    assert.equal(booking.id, 903);
    assert.equal(createdData.clientId, 'client-canonical');
    assert.equal(seenPhoneWhere, '+5493511234567');
  });
});

test('no inicia persistencia cuando falta timeZone en configuración crítica del club', async () => {
  const service = buildServiceHarness();
  service.courtRepo = {
    findById: async () => ({
      id: 10,
      name: 'Cancha 1',
      isUnderMaintenance: false,
      club: {
        id: 5,
        name: 'Club Demo',
        phone: '+5493511234567',
        settings: {
          timeZone: '',
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
  };

  let transactionCalled = false;
  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) => {
    transactionCalled = true;
    return fn({});
  };

  try {
    await assert.rejects(
      () => service.createBooking(
        7,
        10,
        new Date(Date.now() + 24 * 60 * 60 * 1000),
        20,
        60,
        false,
        {}
      ),
      /timeZone es obligatorio/
    );
    assert.equal(transactionCalled, false);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('no inicia persistencia cuando activityType pertenece a otro club', async () => {
  const service = buildServiceHarness();
  service.activityRepo = {
    findById: async () => ({
      id: 20,
      name: 'Futbol 5',
      defaultDurationMinutes: 60,
      clubId: 99,
      scheduleMode: 'FIXED',
      scheduleOpenTime: '08:00',
      scheduleCloseTime: '23:00',
      scheduleIntervalMinutes: 60,
      scheduleWindows: [],
      scheduleDurations: [60],
      scheduleFixedSlots: [{ start: '10:00', duration: 60 }]
    })
  };

  let transactionCalled = false;
  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) => {
    transactionCalled = true;
    return fn({});
  };

  try {
    await assert.rejects(
      () => service.createBooking(
        7,
        10,
        new Date(Date.now() + 24 * 60 * 60 * 1000),
        20,
        60,
        false,
        {}
      ),
      /actividad no pertenece al club de la cancha/i
    );
    assert.equal(transactionCalled, false);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('si clientId es de otro club, no crea booking ni side effects', async () => {
  // El harness default ya tiene schedule FIXED con fixedSlots: [{ start: '10:00', duration: 60 }].
  // Para que la validación de slot pase ANTES de la de club del cliente,
  // usamos una hora determinista que sea 10:00 en Buenos Aires (UTC-3) = 13:00 UTC.
  const service = buildServiceHarness();
  let bookingCreateCalled = false;

  const tx: TxMock = {
    booking: {
      findMany: async () => [],
      create: async () => {
        bookingCreateCalled = true;
        return { id: 9999 };
      }
    },
    client: {
      // Devuelve null → simula que 'client-other-club' no pertenece al club 5
      findFirst: async () => null,
      findUnique: async () => null,
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      create: async (args: any) => ({ id: 'unexpected-client', ...args.data })
    },
    user: {
      findUnique: async () => null
    },
    membership: {
      findMany: async () => []
    },
    bookingBillingConfig: {
      upsert: async () => ({ id: 'cfg-should-not-run' })
    },
    bookingParticipant: createBookingParticipantRepo()
  };

  // 13:00 UTC = 10:00 Buenos Aires (UTC-3). El slot 10:00 existe en el schedule FIXED del harness.
  const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
  futureStart.setUTCHours(13, 0, 0, 0);

  await withMockedTransaction(tx, async () => {
    await assert.rejects(
      () => service.createBooking(
        null,
        10,
        futureStart,
        20,
        60,
        true,
        { clientId: 'client-other-club' }
      ),
      /Cliente no encontrado para el club seleccionado/
    );
  });

  assert.equal(bookingCreateCalled, false);
});

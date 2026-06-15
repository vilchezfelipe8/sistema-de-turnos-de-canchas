import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingService } from '../src/services/BookingService';
import { prisma } from '../src/prisma';

type TxMock = {
  booking: {
    findMany: (args: any) => Promise<any[]>;
    create: (args: any) => Promise<any>;
    findFirst?: (args: any) => Promise<any>;
    findUnique?: (args: any) => Promise<any>;
    update?: (args: any) => Promise<any>;
  };
  client: {
    findFirst: (args: any) => Promise<any>;
    findMany?: (args: any) => Promise<any[]>;
    findUnique?: (args: any) => Promise<any>;
    update?: (args: any) => Promise<any>;
    create?: (args: any) => Promise<any>;
  };
  user: {
    findUnique: (args: any) => Promise<any>;
  };
  membership: {
    findMany: (args: any) => Promise<any[]>;
  };
  bookingBillingConfig: {
    upsert?: (args: any) => Promise<any>;
    findUnique?: (args: any) => Promise<any>;
    update?: (args: any) => Promise<any>;
  };
  bookingParticipant: {
    findFirst: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  auditLog?: {
    create: (args: any) => Promise<any>;
  };
  fixedBooking?: {
    create: (args: any) => Promise<any>;
  };
  account?: {
    findFirst: (args: any) => Promise<any>;
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
          slug: 'club-demo',
          name: 'Club Demo',
          phone: '+5493511234567',
          settings: {
            timeZone: 'America/Argentina/Buenos_Aires',
            openingDays: [0, 1, 2, 3, 4, 5, 6],
            closureDates: [],
            professorDurationOverrideEnabled: false,
            professorDurationOverrideMinutes: 60,
            allowManualConfirmationOverride: true,
            bookingConfirmationMode: 'MANUAL',
            lightsEnabled: false,
            allowAdminSkipSimpleAdvanceLimit: false,
            bookingSimpleAdvanceDaysUser: 365,
            bookingSimpleAdvanceDaysAdmin: 365,
            fixedBookingSettingsByActivity: {
              PADEL: {
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
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@pique.test',
        phoneNumber: '+5493511231234'
      })
    } as any,
    {
      findById: async () => ({
        id: 20,
        name: 'Pádel',
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
    bookingParticipantAdded: async () => null,
    bookingClientChanged: async () => null
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

function bookingCreateResult(data: any) {
  return {
    id: 901,
    ...data,
    user: data.userId ? { id: data.userId } : null,
    client: {
      id: data.clientId,
      name: 'Titular',
      phone: '+5493511231234',
      email: 'ana@pique.test',
      dni: null,
      userId: data.userId ?? null
    },
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
          professorDurationOverrideEnabled: false,
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
      name: 'Pádel',
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

async function withTransactionMock(tx: TxMock, run: () => Promise<void>) {
  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) => fn(tx);
  try {
    await run();
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
}

test('crear reserva con nuevo client crea organizer con userId null', async () => {
  const service = buildServiceHarness();
  const organizerCreates: any[] = [];

  (service as any).resolveOrCreateClient = async () => ({
    id: 'client-new',
    name: 'Cliente Nuevo',
    userId: null,
    email: 'nuevo@pique.test',
    phone: '+5493510001111'
  });

  const tx: TxMock = {
    booking: {
      findMany: async () => [],
      create: async ({ data }: any) => bookingCreateResult(data)
    },
    client: {
      findFirst: async () => null,
      findUnique: async () => null
    },
    user: {
      findUnique: async () => null
    },
    membership: {
      findMany: async () => []
    },
    bookingBillingConfig: {
      upsert: async () => ({ id: 'cfg-1' })
    },
    bookingParticipant: createBookingParticipantRepo({ created: organizerCreates })
  };

  await withTransactionMock(tx, async () => {
    const booking = await service.createBooking(
      null,
      10,
      new Date('2026-05-24T13:00:00.000Z'),
      20,
      60,
      true,
      {
        clientDraft: {
          name: 'Cliente Nuevo',
          phone: '+5493510001111',
          email: 'nuevo@pique.test'
        }
      }
    );

    assert.equal(booking.id, 901);
    assert.equal(organizerCreates.length, 1);
    assert.equal(organizerCreates[0].role, 'ORGANIZER');
    assert.equal(organizerCreates[0].clientId, 'client-new');
    assert.equal(organizerCreates[0].userId, null);
    assert.equal(organizerCreates[0].displayName, 'Cliente Nuevo');
  });
});

test('change owner crea organizer si la reserva legacy no tenía uno', async () => {
  const service = buildServiceHarness();
  const organizerCreates: any[] = [];

  (service as any).resolveOrCreateClient = async () => ({
    id: 'client-new-owner',
    name: 'Nuevo Titular',
    userId: null,
    email: 'nuevo-owner@pique.test',
    phone: '+5493512223333'
  });

  const tx: TxMock = {
    booking: {
      findMany: async () => [],
      findFirst: async () => ({
        id: 300,
        clubId: 5,
        clientId: 'client-old',
        userId: null,
        status: 'CONFIRMED'
      }),
      create: async () => bookingCreateResult({}),
      update: async ({ data }: any) => ({
        id: 300,
        clientId: data.clientId,
        userId: data.userId,
        client: { id: data.clientId, name: 'Nuevo Titular' }
      })
    },
    account: {
      findFirst: async () => ({
        id: 'acc-1',
        status: 'OPEN',
        _count: { payments: 0, refunds: 0 }
      })
    },
    client: {
      findFirst: async () => null
    },
    user: {
      findUnique: async () => null
    },
    membership: {
      findMany: async () => []
    },
    bookingBillingConfig: {
      findUnique: async () => null
    },
    bookingParticipant: createBookingParticipantRepo({ created: organizerCreates })
  };

  await withTransactionMock(tx, async () => {
    const result = await service.changeBookingClient({
      bookingId: 300,
      actorUserId: 9,
      clubId: 5,
      newClientDraft: {
        name: 'Nuevo Titular',
        phone: '+5493512223333',
        email: 'nuevo-owner@pique.test'
      }
    });

    assert.equal(result.clientId, 'client-new-owner');
    assert.equal(organizerCreates.length, 1);
    assert.equal(organizerCreates[0].clientId, 'client-new-owner');
    assert.equal(organizerCreates[0].userId, null);
  });
});

test('agregar participant con client existente crea BookingParticipant PARTICIPANT', async () => {
  const service = buildServiceHarness();
  const participantCreates: any[] = [];
  const historyEntries: any[] = [];
  (service as any).bookingHistoryService = {
    appendBookingHistoryEntryTx: async (_tx: any, input: any) => {
      historyEntries.push(input);
      return { id: `bhe-${historyEntries.length}`, ...input };
    }
  };

  const tx: TxMock = {
    booking: {
      findMany: async () => [],
      findFirst: async () => ({
        id: 410,
        clubId: 5,
        clientId: 'client-owner',
        userId: null,
        status: 'CONFIRMED'
      }),
      create: async () => bookingCreateResult({}),
    },
    client: {
      findFirst: async ({ where }: any) => {
        if (where?.id === 'client-player' && where?.clubId === 5) {
          return {
            id: 'client-player',
            name: 'Jugador Cliente',
            userId: null,
            email: 'player@pique.test',
            phone: '+5493517778888'
          };
        }
        return null;
      }
    },
    user: {
      findUnique: async () => null
    },
    membership: {
      findMany: async () => []
    },
    bookingBillingConfig: {},
    bookingParticipant: {
      findFirst: async ({ where }: any) => {
        if (where?.status?.not === 'REMOVED') return null;
        return null;
      },
      create: async ({ data }: any) => {
        participantCreates.push(data);
        return { id: 'bp-player-created', ...data };
      },
      update: async ({ where, data }: any) => ({ id: where?.id || 'bp-player-updated', ...data })
    },
    auditLog: {
      create: async () => ({ id: 'audit-1' })
    }
  };

  await withTransactionMock(tx, async () => {
    const result = await service.addAdminBookingParticipant({
      bookingId: 410,
      clubId: 5,
      actorUserId: 9,
      personSelection: {
        kind: 'clubClient',
        clientId: 'client-player'
      }
    });

    assert.equal(result.role, 'PARTICIPANT');
    assert.equal(result.clientId, 'client-player');
    assert.equal(result.userId, null);
    assert.equal(participantCreates.length, 1);
    assert.equal(participantCreates[0].clientId, 'client-player');
    assert.equal(participantCreates[0].status, 'JOINED');
    assert.equal(historyEntries.length, 1);
    assert.equal(historyEntries[0].action, 'BOOKING_PARTICIPANT_ADDED');
    assert.equal(historyEntries[0].bookingParticipantId, 'bp-player-created');
    assert.equal(historyEntries[0].detail.clientId, 'client-player');
    assert.equal(historyEntries[0].detail.userId, null);
    assert.equal(historyEntries[0].detail.displayName, 'Jugador Cliente');
  });
});

test('agregar participant con user permitido asegura client y guarda userId', async () => {
  const service = buildServiceHarness();
  const participantCreates: any[] = [];
  const historyEntries: any[] = [];
  (service as any).bookingHistoryService = {
    appendBookingHistoryEntryTx: async (_tx: any, input: any) => {
      historyEntries.push(input);
      return { id: `bhe-${historyEntries.length}`, ...input };
    }
  };

  (service as any).personService.validateSearchSelection = async () => null;
  (service as any).personService.ensureClientForUser = async () => ({
    id: 'client-from-user',
    name: 'Jugador User',
    userId: 88,
    email: 'jugador@pique.test',
    phone: '+5493516667777'
  });

  const tx: TxMock = {
    booking: {
      findMany: async () => [],
      findFirst: async () => ({
        id: 411,
        clubId: 5,
        clientId: 'client-owner',
        userId: null,
        status: 'CONFIRMED'
      }),
      create: async () => bookingCreateResult({}),
    },
    client: {
      findFirst: async () => null
    },
    user: {
      findUnique: async ({ where }: any) => ({
        id: where?.id ?? 88,
        firstName: 'Jugador',
        lastName: 'User',
        email: 'jugador@pique.test',
        phoneNumber: '+5493516667777'
      })
    },
    membership: {
      findMany: async () => []
    },
    bookingBillingConfig: {},
    bookingParticipant: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        participantCreates.push(data);
        return { id: 'bp-player-user', ...data };
      },
      update: async ({ where, data }: any) => ({ id: where?.id || 'bp-player-user-updated', ...data })
    },
    auditLog: {
      create: async () => ({ id: 'audit-2' })
    }
  };

  await withTransactionMock(tx, async () => {
    const result = await service.addAdminBookingParticipant({
      bookingId: 411,
      clubId: 5,
      actorUserId: 9,
      personSelection: {
        kind: 'systemUser',
        userId: 88,
        personKey: 'user:88',
        searchQuery: 'jugador@pique.test'
      }
    });

    assert.equal(result.clientId, 'client-from-user');
    assert.equal(result.userId, 88);
    assert.equal(participantCreates.length, 1);
    assert.equal(participantCreates[0].clientId, 'client-from-user');
    assert.equal(participantCreates[0].userId, 88);
    assert.equal(historyEntries.length, 1);
    assert.equal(historyEntries[0].action, 'BOOKING_PARTICIPANT_ADDED');
    assert.equal(historyEntries[0].detail.clientId, 'client-from-user');
    assert.equal(historyEntries[0].detail.userId, 88);
    assert.equal(historyEntries[0].detail.displayName, 'Jugador User');
  });
});

test('agregar participant con nuevo client duplicado propaga CLIENT_POSSIBLE_DUPLICATE', async () => {
  const service = buildServiceHarness();
  const duplicateError = new Error('possible duplicate') as Error & { code?: string };
  duplicateError.code = 'CLIENT_POSSIBLE_DUPLICATE';
  const historyEntries: any[] = [];
  (service as any).bookingHistoryService = {
    appendBookingHistoryEntryTx: async (_tx: any, input: any) => {
      historyEntries.push(input);
      return { id: `bhe-${historyEntries.length}`, ...input };
    }
  };

  (service as any).resolveOrCreateClient = async () => {
    throw duplicateError;
  };

  const tx: TxMock = {
    booking: {
      findMany: async () => [],
      findFirst: async () => ({
        id: 412,
        clubId: 5,
        clientId: 'client-owner',
        userId: null,
        status: 'CONFIRMED'
      }),
      create: async () => bookingCreateResult({}),
    },
    client: {
      findFirst: async () => null
    },
    user: {
      findUnique: async () => null
    },
    membership: {
      findMany: async () => []
    },
    bookingBillingConfig: {},
    bookingParticipant: {
      findFirst: async () => null,
      create: async ({ data }: any) => ({ id: 'bp-created', ...data }),
      update: async ({ where, data }: any) => ({ id: where?.id || 'bp-updated', ...data })
    },
    auditLog: {
      create: async () => ({ id: 'audit-3' })
    }
  };

  await withTransactionMock(tx, async () => {
    await assert.rejects(
      service.addAdminBookingParticipant({
        bookingId: 412,
        clubId: 5,
        actorUserId: 9,
        personSelection: {
          kind: 'newClient',
          name: 'Participante Nuevo',
          phone: '+5493511112222',
          email: 'nuevo@pique.test'
        }
      }),
      (error: any) => error?.code === 'CLIENT_POSSIBLE_DUPLICATE'
    );
    assert.equal(historyEntries.length, 0);
  });
});

test('remove participant no permite borrar organizer y elimina participant normal', async () => {
  const service = buildServiceHarness();
  const updatedRows: any[] = [];
  const historyEntries: any[] = [];
  (service as any).bookingHistoryService = {
    appendBookingHistoryEntryTx: async (_tx: any, input: any) => {
      historyEntries.push(input);
      return { id: `bhe-${historyEntries.length}`, ...input };
    }
  };

  const originalBookingFindFirst = (prisma.booking as any).findFirst;
  const originalBookingParticipantFindFirst = (prisma.bookingParticipant as any).findFirst;
  const originalTransaction = (prisma as any).$transaction;

  (prisma.booking as any).findFirst = async () => ({ id: 413, clubId: 5 });
  (prisma.bookingParticipant as any).findFirst = async ({ where }: any) => {
    if (where?.id === 'bp-org') {
      return { id: 'bp-org', bookingId: 413, role: 'ORGANIZER', status: 'JOINED' };
    }
    if (where?.id === 'bp-player') {
      return {
        id: 'bp-player',
        bookingId: 413,
        role: 'PARTICIPANT',
        status: 'JOINED',
        clientId: 'client-player',
        userId: 88,
        displayName: 'Jugador User'
      };
    }
    return null;
  };
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      bookingParticipant: {
        update: async ({ where, data }: any) => {
          updatedRows.push({ where, data });
          return { id: where?.id || 'bp-updated', ...data };
        }
      },
      auditLog: {
        create: async () => ({ id: 'audit-4' })
      }
    });

  try {
    await assert.rejects(
      service.removeAdminBookingParticipant({
        bookingId: 413,
        participantId: 'bp-org',
        clubId: 5,
        actorUserId: 9
      }),
      /No se puede remover al titular/
    );
    assert.equal(historyEntries.length, 0);

    const result = await service.removeAdminBookingParticipant({
      bookingId: 413,
      participantId: 'bp-player',
      clubId: 5,
      actorUserId: 9
    });

    assert.deepEqual(result, { success: true });
    assert.equal(updatedRows.length, 1);
    assert.equal(updatedRows[0].where.id, 'bp-player');
    assert.equal(updatedRows[0].data.status, 'REMOVED');
    assert.equal(historyEntries.length, 1);
    assert.equal(historyEntries[0].action, 'BOOKING_PARTICIPANT_REMOVED');
    assert.equal(historyEntries[0].bookingParticipantId, 'bp-player');
    assert.equal(historyEntries[0].detail.clientId, 'client-player');
    assert.equal(historyEntries[0].detail.userId, 88);
  } finally {
    (prisma.booking as any).findFirst = originalBookingFindFirst;
    (prisma.bookingParticipant as any).findFirst = originalBookingParticipantFindFirst;
    (prisma as any).$transaction = originalTransaction;
  }
});

test('mis reservas incluye participant.userId joined', async () => {
  const service = buildServiceHarness();

  const originalBookingFindMany = (prisma.booking as any).findMany;
  const originalAccountFindMany = (prisma.account as any).findMany;
  (prisma.booking as any).findMany = async () => [
    {
      id: 702,
      displayCode: 'RES-702',
      startDateTime: new Date('2026-07-21T21:00:00.000Z'),
      endDateTime: new Date('2026-07-21T22:00:00.000Z'),
      status: 'CONFIRMED',
      userId: null,
      court: {
        name: 'Cancha 2',
        club: {
          id: 5,
          name: 'Club Demo',
          slug: 'club-demo'
        }
      },
      activity: { name: 'Pádel' },
      client: { id: 'client-2', userId: null },
      participants: [
        { id: 'bp-player', userId: 91, status: 'JOINED', role: 'PARTICIPANT' }
      ]
    }
  ];
  (prisma.account as any).findMany = async () => [];

  try {
    const bookings = await service.getPlayerBookings(91);
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].myRole, 'PARTICIPANT');
  } finally {
    (prisma.booking as any).findMany = originalBookingFindMany;
    (prisma.account as any).findMany = originalAccountFindMany;
  }
});

test('quote no crea organizer participant', async () => {
  const service = buildServiceHarness();
  let organizerTouched = false;

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      client: {
        findFirst: async () => null,
        findMany: async () => []
      },
      discountPolicy: {
        findMany: async () => []
      },
      bookingParticipant: {
        create: async () => {
          organizerTouched = true;
          return null;
        }
      }
    });

  try {
    const quote = await service.quoteBookingPrice({
      courtId: 10,
      activityId: 20,
      startDateTime: new Date('2026-05-24T13:00:00.000Z'),
      durationMinutes: 60,
      allowAdminBenefits: true,
      clientEmail: 'quote-only@pique.test',
      clientPhone: '+5493519990000'
    } as any);

    assert.equal(Number(quote.finalPrice), 10000);
    assert.equal(organizerTouched, false);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('mis reservas incluye al organizer por organizer.userId y mantiene compatibilidad legacy', async () => {
  const service = buildServiceHarness();

  const originalBookingFindMany = (prisma.booking as any).findMany;
  const originalAccountFindMany = (prisma.account as any).findMany;
  (prisma.booking as any).findMany = async () => [
    {
      id: 701,
      displayCode: 'RES-701',
      startDateTime: new Date('2026-07-20T21:00:00.000Z'),
      endDateTime: new Date('2026-07-20T22:00:00.000Z'),
      status: 'CONFIRMED',
      userId: null,
      court: {
        name: 'Cancha 1',
        club: {
          id: 5,
          name: 'Club Demo',
          slug: 'club-demo'
        }
      },
      activity: { name: 'Pádel' },
      client: { id: 'client-1', userId: null },
      participants: [
        { id: 'bp-org', userId: 77, status: 'JOINED', role: 'ORGANIZER' }
      ]
    }
  ];
  (prisma.account as any).findMany = async () => [];

  try {
    const bookings = await service.getPlayerBookings(77);
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].myRole, 'OWNER');
  } finally {
    (prisma.booking as any).findMany = originalBookingFindMany;
    (prisma.account as any).findMany = originalAccountFindMany;
  }
});

test('fixed booking usa createBooking y genera organizer para cada booking creado', async () => {
  const service = buildServiceHarness();
  const organizerCreates: any[] = [];

  const originalFixedBookingFindMany = (prisma.fixedBooking as any).findMany;
  const originalClientFindFirst = (prisma.client as any).findFirst;

  (prisma.fixedBooking as any).findMany = async () => [];
  (prisma.client as any).findFirst = async ({ where }: any) => {
    if (where?.id === 'client-fixed' && where?.clubId === 5) {
      return { id: 'client-fixed', userId: null, phone: '+5493514445555' };
    }
    return null;
  };

  const tx: TxMock = {
    booking: {
      findMany: async () => [],
      findFirst: async () => null,
      create: async ({ data }: any) => bookingCreateResult(data),
      update: async ({ where, data }: any) => ({ id: where.id, ...data })
    },
    client: {
      findFirst: async ({ where }: any) => {
        if (where?.id === 'client-fixed' && where?.clubId === 5) {
          return {
            id: 'client-fixed',
            name: 'Cliente Fijo',
            userId: null,
            email: 'fixed@pique.test',
            phone: '+5493514445555'
          };
        }
        return null;
      },
      findUnique: async () => null
    },
    user: {
      findUnique: async () => null
    },
    membership: {
      findMany: async () => []
    },
    bookingBillingConfig: {
      upsert: async () => ({ id: 'cfg-fixed' })
    },
    bookingParticipant: createBookingParticipantRepo({ created: organizerCreates }),
    fixedBooking: {
      create: async () => ({ id: 77 })
    }
  };

  try {
    await withTransactionMock(tx, async () => {
      const result = await service.createFixedBooking(
        10,
        20,
        new Date('2026-05-24T13:00:00.000Z'),
        {
          clientId: 'client-fixed',
          durationMinutes: 60,
          actorUserId: 9
        }
      );

      assert.equal(result.generatedCount, 1);
      assert.equal(organizerCreates.length, 1);
      assert.equal(organizerCreates[0].role, 'ORGANIZER');
      assert.equal(organizerCreates[0].clientId, 'client-fixed');
    });
  } finally {
    (prisma.fixedBooking as any).findMany = originalFixedBookingFindMany;
    (prisma.client as any).findFirst = originalClientFindFirst;
  }
});

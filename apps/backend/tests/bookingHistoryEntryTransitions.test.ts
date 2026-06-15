import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingService } from '../src/services/BookingService';
import { prisma } from '../src/prisma';

function buildServiceHarness(historyEntries: any[]) {
  const service = new BookingService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  ) as any;

  service.auditLogService = {
    create: async () => null
  };
  service.eventService = {
    bookingConfirmed: async () => null,
    bookingCompleted: async () => null,
    bookingCancelled: async () => null,
    bookingClientChanged: async () => null,
  };
  service.bookingHistoryService = {
    appendBookingHistoryEntryTx: async (_tx: any, input: any) => {
      const entry = {
        ...input,
        occurredAt: input?.occurredAt ?? new Date('2026-05-21T20:00:00.000Z'),
      };
      historyEntries.push(entry);
      return { id: `bhe-${historyEntries.length}`, ...entry };
    }
  };
  service.getBookingById = async (bookingId: number) => ({ id: bookingId, status: 'CONFIRMED' });
  service.ensureBookingAccountWithChargeTx = async () => ({ id: 'acc-1' });
  service.bookingDomainService = {
    confirmBookingManuallyTx: async () => 'CONFIRMED'
  };
  service.projectionService = {
    refreshAccountSummary: async () => null
  };

  return service;
}

test('confirmBooking genera BOOKING_CONFIRMED con contenido mínimo útil', async () => {
  const historyEntries: any[] = [];
  const service = buildServiceHarness(historyEntries);

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
    assert.equal(historyEntries.length, 1);
    assert.equal(historyEntries[0].bookingId, 11);
    assert.equal(historyEntries[0].clubId, 2);
    assert.equal(historyEntries[0].action, 'BOOKING_CONFIRMED');
    assert.equal(historyEntries[0].category, 'BOOKING');
    assert.equal(historyEntries[0].source, 'ADMIN');
    assert.ok(String(historyEntries[0].summary || '').trim().length > 0);
    assert.equal(historyEntries[0].actorUserId, 99);
    assert.ok(historyEntries[0].occurredAt instanceof Date);
    assert.deepEqual(historyEntries[0].previousState, { status: 'PENDING' });
    assert.deepEqual(historyEntries[0].nextState, { status: 'CONFIRMED' });
    assert.deepEqual(historyEntries[0].detail, {
      previousStatus: 'PENDING',
      status: 'CONFIRMED',
      source: 'MANUAL',
    });
    assert.deepEqual(historyEntries[0].metadata, {
      kind: 'STATUS_TRANSITION',
    });
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('cancelBooking genera BOOKING_CANCELLED con estados y motivo', async () => {
  const historyEntries: any[] = [];
  const service = buildServiceHarness(historyEntries);

  service.bookingRepo = {
    findById: async () => ({
      id: 710,
      status: 'PENDING',
      user: null,
      court: { id: 1, club: { id: 15, name: 'Club Test' } },
      activity: { id: 5 }
    })
  };
  service.outboxService = { enqueueMany: async () => null };
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
          client: null,
        }),
        update: async () => ({ id: 710, status: 'CANCELLED' })
      },
      account: {
        findFirst: async () => null
      }
    });

  try {
    await service.cancelBooking(710, null, undefined, {
      skipAccessValidation: true,
      reason: 'MANUAL',
      triggeredBy: 'ADMIN',
    });
    assert.equal(historyEntries.length, 1);
    assert.equal(historyEntries[0].action, 'BOOKING_CANCELLED');
    assert.deepEqual(historyEntries[0].previousState, { status: 'PENDING' });
    assert.deepEqual(historyEntries[0].nextState, { status: 'CANCELLED' });
    assert.equal((historyEntries[0].detail || {}).reason, 'MANUAL');
    assert.equal((historyEntries[0].detail || {}).triggeredBy, 'ADMIN');
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('cancelBooking no genera history si la operación falla', async () => {
  const historyEntries: any[] = [];
  const service = buildServiceHarness(historyEntries);

  service.bookingRepo = {
    findById: async () => ({
      id: 711,
      status: 'CONFIRMED',
      user: null,
      court: { id: 1, club: { id: 15, name: 'Club Test' } },
      activity: { id: 5 }
    })
  };
  service.outboxService = { enqueueMany: async () => null };
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
        update: async () => ({ id: 711, status: 'CANCELLED' })
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
    assert.equal(historyEntries.length, 0);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('completeBooking genera BOOKING_COMPLETED con transición de estado', async () => {
  const historyEntries: any[] = [];
  const service = buildServiceHarness(historyEntries);
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
        update: async () => ({ id: 77, status: 'COMPLETED' })
      },
      account: {
        findFirst: async () => ({ id: 'acc-77' })
      }
    });

  try {
    await service.completeBooking(77, 99, 3);
    assert.equal(historyEntries.length, 1);
    assert.equal(historyEntries[0].action, 'BOOKING_COMPLETED');
    assert.deepEqual(historyEntries[0].previousState, { status: 'CONFIRMED' });
    assert.deepEqual(historyEntries[0].nextState, { status: 'COMPLETED' });
    assert.deepEqual(historyEntries[0].detail, {
      previousStatus: 'CONFIRMED',
      status: 'COMPLETED',
    });
    assert.deepEqual(historyEntries[0].metadata, {
      kind: 'STATUS_TRANSITION',
    });
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('createBooking no genera history si falla por CLIENT_POSSIBLE_DUPLICATE', async () => {
  const historyEntries: any[] = [];
  const service = buildServiceHarness(historyEntries);
  const duplicateError = new Error('possible duplicate') as Error & { code?: string };
  duplicateError.code = 'CLIENT_POSSIBLE_DUPLICATE';

  service.courtRepo = {
    findById: async () => ({
      id: 10,
      club: {
        id: 1,
        settings: {
          bookingCancellationHours: 24,
          allowBookingCancellation: true,
          slotGranularityMinutes: 30,
        }
      },
      branchId: null,
      type: 'SINGLE'
    })
  };
  service.activityRepo = {
    findById: async () => ({
      id: 20,
      clubId: 1,
      duration: 60,
      isFixedDuration: true
    })
  };
  service.userRepo = {
    findById: async () => null
  };
  service.resolveClientProfessorStatus = async () => false;
  service.resolveClubConfig = () => ({
    timeZone: 'America/Argentina/Buenos_Aires',
    openingDays: [1, 2, 3, 4, 5, 6, 0],
    bookingSimpleAdvanceDaysUser: 30,
    bookingSimpleAdvanceDaysAdmin: 365,
    professorDurationOverrideEnabled: false,
    professorDurationOverrideMinutes: 60,
    allowManualConfirmationOverride: true,
    bookingConfirmationMode: 'MANUAL',
    lightsEnabled: false,
  });
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
  service.pricingService = { calculateCourtPrice: async () => 10000 };
  service.resolveOrCreateClient = async () => {
    throw duplicateError;
  };

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      booking: {
        findMany: async () => [],
      },
      client: {
        findFirst: async () => null,
      },
      membership: {
        findMany: async () => [],
      },
      user: {
        findUnique: async () => null,
      },
    });

  try {
    await assert.rejects(
      () => service.createBooking(
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
      ),
      (error: any) => error?.code === 'CLIENT_POSSIBLE_DUPLICATE'
    );
    assert.equal(historyEntries.length, 0);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('upsertBookingBillingConfig no genera history visible en la primera sincronización post-create', async () => {
  const historyEntries: any[] = [];
  const eventCalls: string[] = [];
  const service = buildServiceHarness(historyEntries);

  service.bookingDomainService = {
    getBookingFinancialSummaryTx: async () => ({ total: 10000 })
  };
  service.eventService = {
    bookingParticipantAdded: async () => { eventCalls.push('BOOKING_PARTICIPANT_ADDED'); },
    bookingParticipantRemoved: async () => { eventCalls.push('BOOKING_PARTICIPANT_REMOVED'); },
    bookingBillingConfigUpdated: async () => { eventCalls.push('BOOKING_BILLING_CONFIG_UPDATED'); },
    bookingNotesUpdated: async () => { eventCalls.push('BOOKING_NOTES_UPDATED'); },
  };

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      booking: {
        findFirst: async () => ({
          id: 301,
          clubId: 5,
          status: 'PENDING',
          clientId: 'client-owner',
          userId: null,
          price: 10000,
          createdAt: new Date('2026-05-21T18:00:00.000Z'),
        }),
      },
      bookingBillingConfig: {
        findUnique: async () => ({
          assignmentsJson: {
            schemaVersion: 1,
            assignments: [
              {
                id: 'asg-booking-responsible',
                participantRef: 'booking-client:client-owner',
                isChargeable: true,
                assignedAmount: 10000,
                participantLinkState: 'ACTIVE',
              }
            ]
          },
          metadataJson: {
            schemaVersion: 1,
            source: 'PERSISTED',
            initializedBy: 'BOOKING_CREATED',
          },
          chargeMode: 'INDIVIDUAL',
          chargeResponsibleRef: 'booking-client:client-owner',
        }),
        upsert: async ({ data }: any) => ({
          bookingId: 301,
          clubId: 5,
          chargeMode: data?.create?.chargeMode ?? 'SHARED',
          chargeResponsibleRef: data?.create?.chargeResponsibleRef ?? null,
          assignmentsJson: data?.create?.assignmentsJson ?? { schemaVersion: 1, assignments: [] },
          metadataJson: data?.create?.metadataJson ?? { schemaVersion: 1, source: 'PERSISTED' },
          updatedAt: new Date('2026-05-21T18:05:00.000Z'),
        }),
      },
      account: {
        findFirst: async () => null,
      },
    });

  try {
    await service.upsertBookingBillingConfig({
      bookingId: 301,
      clubId: 5,
      actorUserId: 9,
      chargeMode: 'SHARED',
      assignments: [
        {
          id: 'asg-booking-responsible',
          participantRef: 'booking-client:client-owner',
          isChargeable: true,
          assignedAmount: 5000,
          participantLinkState: 'ACTIVE',
        },
        {
          id: 'asg-player-2',
          participantRef: 'guest:player-2',
          isChargeable: true,
          assignedAmount: 5000,
          participantLinkState: 'ACTIVE',
        },
      ],
      metadata: {
        sidebar: {
          notes: 'nota inicial',
        }
      } as any,
    });

    assert.equal(historyEntries.length, 0);
    assert.deepEqual(eventCalls, []);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('upsertBookingBillingConfig no genera history visible cuando la config fue auto-inicializada al leer', async () => {
  const historyEntries: any[] = [];
  const eventCalls: string[] = [];
  const service = buildServiceHarness(historyEntries);

  service.bookingDomainService = {
    getBookingFinancialSummaryTx: async () => ({ total: 10000 })
  };
  service.eventService = {
    bookingParticipantAdded: async () => { eventCalls.push('BOOKING_PARTICIPANT_ADDED'); },
    bookingParticipantRemoved: async () => { eventCalls.push('BOOKING_PARTICIPANT_REMOVED'); },
    bookingBillingConfigUpdated: async () => { eventCalls.push('BOOKING_BILLING_CONFIG_UPDATED'); },
    bookingNotesUpdated: async () => { eventCalls.push('BOOKING_NOTES_UPDATED'); },
  };

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      booking: {
        findFirst: async () => ({
          id: 302,
          clubId: 5,
          status: 'PENDING',
          clientId: 'client-owner',
          userId: null,
          price: 10000,
          createdAt: new Date('2026-05-21T18:00:00.000Z'),
        }),
      },
      bookingBillingConfig: {
        findUnique: async () => ({
          assignmentsJson: {
            schemaVersion: 1,
            assignments: [
              {
                id: 'asg-booking-responsible',
                participantRef: 'booking-client:client-owner',
                isChargeable: true,
                assignedAmount: 10000,
                participantLinkState: 'ACTIVE',
              }
            ]
          },
          metadataJson: {
            schemaVersion: 1,
            source: 'PERSISTED',
            initializedBy: 'AUTO_INITIALIZE_ON_READ',
          },
          chargeMode: 'INDIVIDUAL',
          chargeResponsibleRef: 'booking-client:client-owner',
        }),
        upsert: async ({ data }: any) => ({
          bookingId: 302,
          clubId: 5,
          chargeMode: data?.create?.chargeMode ?? 'SHARED',
          chargeResponsibleRef: data?.create?.chargeResponsibleRef ?? null,
          assignmentsJson: data?.create?.assignmentsJson ?? { schemaVersion: 1, assignments: [] },
          metadataJson: data?.create?.metadataJson ?? { schemaVersion: 1, source: 'PERSISTED' },
          updatedAt: new Date('2026-05-21T18:05:00.000Z'),
        }),
      },
      account: {
        findFirst: async () => null,
      },
    });

  try {
    await service.upsertBookingBillingConfig({
      bookingId: 302,
      clubId: 5,
      actorUserId: 9,
      chargeMode: 'SHARED',
      assignments: [
        {
          id: 'asg-booking-responsible',
          participantRef: 'booking-client:client-owner',
          isChargeable: true,
          assignedAmount: 5000,
          participantLinkState: 'ACTIVE',
        },
        {
          id: 'asg-player-2',
          participantRef: 'guest:player-2',
          isChargeable: true,
          assignedAmount: 5000,
          participantLinkState: 'ACTIVE',
        },
      ],
      metadata: {
        sidebar: {
          notes: 'nota inicial',
        }
      } as any,
    });

    assert.equal(historyEntries.length, 0);
    assert.deepEqual(eventCalls, []);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

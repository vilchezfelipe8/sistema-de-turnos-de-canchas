import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingService } from '../src/services/BookingService';
import { prisma } from '../src/prisma';

type TxMock = {
  booking: {
    findMany: (args: any) => Promise<any[]>;
    create: (args: any) => Promise<any>;
    findFirst?: (args: any) => Promise<any>;
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
    upsert: (args: any) => Promise<any>;
    findUnique?: (args: any) => Promise<any>;
    update?: (args: any) => Promise<any>;
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
            bookingSimpleAdvanceDaysAdmin: 365
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

test('admin puede crear reserva con clubClient existente sin usar ensureClientForUser', async () => {
  const service = buildServiceHarness();
  let createdData: any = null;
  let ensureCalls = 0;

  (service as any).personService = {
    ensureClientForUser: async () => {
      ensureCalls += 1;
      return { id: 'should-not-run' };
    },
    validateSearchSelection: async () => null
  } as any;

  const tx: TxMock = {
    booking: {
      findMany: async () => [],
      create: async (args: any) => {
        createdData = args.data;
        return bookingCreateResult(args.data);
      }
    },
    client: {
      findFirst: async (args: any) => {
        if (args?.where?.id === 'client-1' && args?.where?.clubId === 5) {
          return { id: 'client-1', name: 'Cliente Uno', userId: null };
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
    bookingBillingConfig: {
      upsert: async () => ({ id: 'cfg-1' })
    }
  };

  await withMockedTransaction(tx, async () => {
    const result = await service.createBooking(
      null,
      10,
      new Date('2026-05-22T13:00:00.000Z'),
      20,
      60,
      true,
      {
        actorUserId: 9,
        clientId: 'client-1'
      }
    );

    assert.equal(result.id, 901);
    assert.equal(createdData.clientId, 'client-1');
    assert.equal(createdData.userId, null);
    assert.equal(ensureCalls, 0);
  });
});

test('admin puede crear reserva con systemUser permitido y asegura client del club', async () => {
  const service = buildServiceHarness();
  let createdData: any = null;
  let validateCalls = 0;
  let ensureCalls = 0;

  (service as any).personService = {
    validateSearchSelection: async (_clubId: number, input: any) => {
      validateCalls += 1;
      assert.equal(input.userId, 77);
      return {
        kind: 'systemUser',
        personKey: 'user:77',
        userId: 77,
        clientId: null
      };
    },
    ensureClientForUser: async (_clubId: number, userId: number) => {
      ensureCalls += 1;
      assert.equal(userId, 77);
      return {
        id: 'client-user-77',
        name: 'Ana Pérez',
        userId: 77,
        phone: '+5493511231234'
      };
    }
  } as any;

  const tx: TxMock = {
    booking: {
      findMany: async () => [],
      create: async (args: any) => {
        createdData = args.data;
        return bookingCreateResult(args.data);
      }
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
      upsert: async () => ({ id: 'cfg-2' })
    }
  };

  await withMockedTransaction(tx, async () => {
    const result = await service.createBooking(
      null,
      10,
      new Date('2026-05-22T13:00:00.000Z'),
      20,
      60,
      true,
      {
        actorUserId: 9,
        ownerUserSelection: {
          userId: 77,
          personKey: 'user:77',
          searchQuery: 'ana@pique.test'
        }
      }
    );

    assert.equal(result.id, 901);
    assert.equal(createdData.clientId, 'client-user-77');
    assert.equal(createdData.userId, 77);
    assert.equal(validateCalls, 1);
    assert.equal(ensureCalls, 1);
  });
});

test('admin no puede crear reserva con clientId de otro club', async () => {
  const service = buildServiceHarness();

  const tx: TxMock = {
    booking: {
      findMany: async () => [],
      create: async (_args: any) => bookingCreateResult({})
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
      upsert: async () => ({ id: 'cfg-3' })
    }
  };

  await withMockedTransaction(tx, async () => {
    await assert.rejects(
      () => service.createBooking(
        null,
        10,
        new Date('2026-05-22T13:00:00.000Z'),
        20,
        60,
        true,
        {
          actorUserId: 9,
          clientId: 'client-other-club'
        }
      ),
      /Cliente no encontrado para el club seleccionado/
    );
  });
});

test('changeBookingClient puede cambiar titular a systemUser permitido y asegurar client', async () => {
  const service = buildServiceHarness();
  let bookingUpdateData: any = null;

  (service as any).personService = {
    validateSearchSelection: async () => ({
      kind: 'linked',
      personKey: 'linked:client:client-ensured:user:77',
      userId: 77,
      clientId: 'client-ensured'
    }),
    ensureClientForUser: async () => ({
      id: 'client-ensured',
      name: 'Ana Pérez',
      userId: 77
    })
  } as any;

  const tx: any = {
    booking: {
      findFirst: async () => ({
        id: 300,
        clubId: 5,
        clientId: 'client-old',
        userId: null,
        status: 'PENDING'
      }),
      update: async (args: any) => {
        bookingUpdateData = args.data;
        return {
          id: 300,
          clientId: args.data.clientId,
          userId: args.data.userId,
          client: { id: args.data.clientId, name: 'Ana Pérez' }
        };
      }
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
    bookingBillingConfig: {
      findUnique: async () => null
    }
  };

  await withMockedTransaction(tx, async () => {
    const result = await service.changeBookingClient({
      bookingId: 300,
      actorUserId: 9,
      clubId: 5,
      ownerUserSelection: {
        userId: 77,
        personKey: 'user:77',
        searchQuery: 'ana@pique.test'
      }
    });

    assert.equal(result.clientId, 'client-ensured');
    assert.deepEqual(bookingUpdateData, { clientId: 'client-ensured', userId: 77 });
  });
});

test('changeBookingClient puede cambiar titular a newClient reutilizando resolveOrCreateClient', async () => {
  const service = buildServiceHarness();
  let bookingUpdateData: any = null;

  (service as any).resolveOrCreateClient = async () => ({
    id: 'client-new',
    name: 'Nuevo Titular',
    userId: null
  });

  const tx: any = {
    booking: {
      findFirst: async () => ({
        id: 301,
        clubId: 5,
        clientId: 'client-old',
        userId: null,
        status: 'CONFIRMED'
      }),
      update: async (args: any) => {
        bookingUpdateData = args.data;
        return {
          id: 301,
          clientId: args.data.clientId,
          userId: args.data.userId,
          client: { id: args.data.clientId, name: 'Nuevo Titular' }
        };
      }
    },
    account: {
      findFirst: async () => ({
        id: 'acc-2',
        status: 'OPEN',
        _count: { payments: 0, refunds: 0 }
      })
    },
    client: {
      findFirst: async () => null
    },
    bookingBillingConfig: {
      findUnique: async () => null
    }
  };

  await withMockedTransaction(tx, async () => {
    const result = await service.changeBookingClient({
      bookingId: 301,
      actorUserId: 9,
      clubId: 5,
      newClientDraft: {
        name: 'Nuevo Titular',
        phone: '+5493511112222',
        email: 'nuevo@pique.test',
        dni: '30111222'
      }
    });

    assert.equal(result.clientId, 'client-new');
    assert.deepEqual(bookingUpdateData, { clientId: 'client-new', userId: null });
  });
});

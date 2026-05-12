import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingService } from '../src/services/BookingService';
import { BookingController } from '../src/controllers/BookingController';
import { prisma } from '../src/prisma';

function buildService() {
  return new BookingService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any) as any;
}

function buildRes() {
  const payload: any = { statusCode: 200, body: null };
  const res: any = {
    status(code: number) {
      payload.statusCode = code;
      return res;
    },
    json(data: any) {
      payload.body = data;
      return res;
    }
  };
  return { res, payload };
}

async function withTransactionMock(tx: any, run: () => Promise<void>) {
  const original = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) => fn(tx);
  try {
    await run();
  } finally {
    (prisma as any).$transaction = original;
  }
}

test('changeBookingClient permite cambio manual explícito cuando no hay pagos/devoluciones y todo pertenece al club', async () => {
  const service = buildService();
  const auditCalls: any[] = [];
  service.eventService = {
    bookingClientChanged: async () => null
  };
  service.auditLogService = {
    create: async (payload: any) => {
      auditCalls.push(payload);
      return null;
    }
  };

  let clientUpdateCalls = 0;

  await withTransactionMock(
    {
      booking: {
        findFirst: async () => ({ id: 501, clubId: 5, clientId: 'client-old', status: 'PENDING' }),
        update: async () => ({
          id: 501,
          clientId: 'client-new',
          client: { id: 'client-new', name: 'Nuevo Titular' }
        })
      },
      client: {
        findFirst: async () => ({ id: 'client-new', name: 'Nuevo Titular' }),
        update: async () => {
          clientUpdateCalls += 1;
          return { id: 'x' };
        }
      },
      account: {
        findFirst: async () => ({ id: 'acc-1', status: 'OPEN', _count: { payments: 0, refunds: 0 } })
      },
      bookingBillingConfig: {
        findUnique: async () => null
      }
    },
    async () => {
      const updated = await service.changeBookingClient({
        bookingId: 501,
        newClientId: 'client-new',
        actorUserId: 77,
        clubId: 5,
        reason: 'Corrección de mostrador'
      });

      assert.equal(updated.clientId, 'client-new');
      assert.equal(auditCalls.length, 1);
      assert.equal(auditCalls[0].action, 'BOOKING_CLIENT_CHANGED');
      assert.equal(auditCalls[0].payload.oldClientId, 'client-old');
      assert.equal(auditCalls[0].payload.newClientId, 'client-new');
      assert.equal(clientUpdateCalls, 0);
    }
  );
});

test('changeBookingClient falla si el nuevo titular pertenece a otro club', async () => {
  const service = buildService();
  service.eventService = {
    bookingClientChanged: async () => null
  };
  service.auditLogService = { create: async () => null };

  await withTransactionMock(
    {
      booking: {
        findFirst: async () => ({ id: 502, clubId: 5, clientId: 'client-old', status: 'PENDING' }),
        update: async () => {
          throw new Error('No debería actualizar booking');
        }
      },
      client: {
        findFirst: async () => null
      },
      account: {
        findFirst: async () => ({ id: 'acc-2', status: 'OPEN', _count: { payments: 0, refunds: 0 } })
      },
      bookingBillingConfig: {
        findUnique: async () => null
      }
    },
    async () => {
      await assert.rejects(
        () =>
          service.changeBookingClient({
            bookingId: 502,
            newClientId: 'client-other-club',
            actorUserId: 77,
            clubId: 5
          }),
        /no existe en este club/i
      );
    }
  );
});

test('changeBookingClient falla si la reserva ya está completada', async () => {
  const service = buildService();
  service.eventService = {
    bookingClientChanged: async () => null
  };
  service.auditLogService = { create: async () => null };

  await withTransactionMock(
    {
      booking: {
        findFirst: async () => ({ id: 503, clubId: 5, clientId: 'client-old', status: 'COMPLETED' }),
        update: async () => {
          throw new Error('No debería actualizar booking');
        }
      },
      client: {
        findFirst: async () => ({ id: 'client-new', name: 'Nuevo Titular' })
      },
      account: {
        findFirst: async () => ({ id: 'acc-3', status: 'OPEN', _count: { payments: 0, refunds: 0 } })
      },
      bookingBillingConfig: {
        findUnique: async () => null
      }
    },
    async () => {
      await assert.rejects(
        () =>
          service.changeBookingClient({
            bookingId: 503,
            newClientId: 'client-new',
            actorUserId: 77,
            clubId: 5
          }),
        /estado actual/i
      );
    }
  );
});

test('changeBookingClient falla si hay pagos o devoluciones o cuenta cerrada', async () => {
  const service = buildService();
  service.eventService = {
    bookingClientChanged: async () => null
  };
  service.auditLogService = { create: async () => null };

  await withTransactionMock(
    {
      booking: {
        findFirst: async () => ({ id: 504, clubId: 5, clientId: 'client-old', status: 'CONFIRMED' }),
        update: async () => {
          throw new Error('No debería actualizar booking');
        }
      },
      client: {
        findFirst: async () => ({ id: 'client-new', name: 'Nuevo Titular' })
      },
      account: {
        findFirst: async () => ({ id: 'acc-4', status: 'CLOSED', _count: { payments: 1, refunds: 0 } })
      },
      bookingBillingConfig: {
        findUnique: async () => null
      }
    },
    async () => {
      await assert.rejects(
        () =>
          service.changeBookingClient({
            bookingId: 504,
            newClientId: 'client-new',
            actorUserId: 77,
            clubId: 5
          }),
        /pagos|devoluciones|cerrada/i
      );
    }
  );
});

test('upsertBookingBillingConfig no puede cambiar Booking.clientId por participantRef o chargeResponsibleRef', async () => {
  const service = buildService();
  service.bookingDomainService = {
    getBookingFinancialSummaryTx: async () => ({ total: 100 })
  };
  service.eventService = {
    bookingParticipantAdded: async () => null,
    bookingParticipantRemoved: async () => null,
    bookingBillingConfigUpdated: async () => null,
    bookingNotesUpdated: async () => null
  };

  let bookingUpdateCalls = 0;

  await withTransactionMock(
    {
      booking: {
        findFirst: async () => ({
          id: 610,
          clubId: 5,
          status: 'PENDING',
          clientId: 'client-canonico',
          userId: null,
          price: 100,
          createdAt: new Date('2026-01-01T10:00:00.000Z')
        }),
        update: async () => {
          bookingUpdateCalls += 1;
          return { id: 610 };
        }
      },
      bookingBillingConfig: {
        findUnique: async () => null,
        upsert: async () => ({
          bookingId: 610,
          clubId: 5,
          chargeMode: 'INDIVIDUAL',
          chargeResponsibleRef: 'user:999',
          assignmentsJson: {
            schemaVersion: 1,
            assignments: [
              {
                id: 'asg-1',
                participantRef: 'user:999',
                isChargeable: true,
                assignedAmount: 100,
                participantLinkState: 'ACTIVE'
              }
            ]
          },
          metadataJson: {},
          updatedAt: new Date('2026-01-01T10:05:00.000Z')
        })
      },
      account: {
        findFirst: async () => null
      }
    },
    async () => {
      const result = await service.upsertBookingBillingConfig({
        bookingId: 610,
        clubId: 5,
        actorUserId: 77,
        chargeMode: 'INDIVIDUAL',
        chargeResponsibleRef: 'user:999',
        assignments: [
          {
            id: 'asg-1',
            participantRef: 'user:999',
            isChargeable: true,
            assignedAmount: 100,
            participantLinkState: 'ACTIVE'
          }
        ],
        metadata: { sidebarNotes: 'sin cambios de titular' }
      });

      assert.equal(result.bookingId, 610);
      assert.equal(bookingUpdateCalls, 0);
    }
  );
});

test('controller rechaza participantRef inválido y no llama al service', async () => {
  let serviceCalls = 0;
  const controller = new BookingController({
    upsertBookingBillingConfig: async () => {
      serviceCalls += 1;
      return { ok: true };
    }
  } as any);

  const req: any = {
    params: { id: '610' },
    body: {
      chargeMode: 'INDIVIDUAL',
      chargeResponsibleRef: 'booking-client:client-canonico',
      assignments: [
        {
          id: 'asg-1',
          participantRef: 'ownerRefWithoutPrefix',
          isChargeable: true,
          assignedAmount: 100
        }
      ]
    },
    clubId: 5,
    user: { userId: 77 }
  };
  const { res, payload } = buildRes();

  await controller.upsertBookingBillingConfig(req, res);

  assert.equal(payload.statusCode, 400);
  assert.equal(payload.body?.code, 'VALIDATION_ERROR');
  assert.equal(serviceCalls, 0);
});

test('controller rechaza chargeResponsibleRef inválido y no llama al service', async () => {
  let serviceCalls = 0;
  const controller = new BookingController({
    upsertBookingBillingConfig: async () => {
      serviceCalls += 1;
      return { ok: true };
    }
  } as any);

  const req: any = {
    params: { id: '610' },
    body: {
      chargeMode: 'INDIVIDUAL',
      chargeResponsibleRef: 'responsable-sin-prefijo',
      assignments: [
        {
          id: 'asg-1',
          participantRef: 'booking-client:client-canonico',
          isChargeable: true,
          assignedAmount: 100
        }
      ]
    },
    clubId: 5,
    user: { userId: 77 }
  };
  const { res, payload } = buildRes();

  await controller.upsertBookingBillingConfig(req, res);

  assert.equal(payload.statusCode, 400);
  assert.equal(payload.body?.code, 'VALIDATION_ERROR');
  assert.equal(serviceCalls, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingController } from '../src/controllers/BookingController';

function createResponseHarness() {
  const state: any = {
    statusCode: 200,
    body: null,
  };
  const res: any = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: any) {
      state.body = payload;
      return this;
    },
  };
  return { res, state };
}

test('BookingController.getAdminBookingHistory devuelve solo BookingHistoryEntry ordenado y estable', async () => {
  const controller = new BookingController({
    getAdminBookingHistory: async () => ([
      {
        id: 'bhe-1',
        bookingId: 44,
        clubId: 7,
        action: 'BOOKING_CREATED',
        category: 'BOOKING',
        source: 'ADMIN',
        summary: 'Reserva creada',
        occurredAt: new Date('2026-05-21T20:00:00.000Z'),
        actorUserId: 18,
        actorLabel: 'Admin Las Tejas',
        detail: { amount: 10000 },
        previousState: null,
        nextState: { status: 'PENDING' },
        bookingParticipantId: null,
        paymentId: null,
        accountId: null,
        metadata: null,
      },
    ]),
  } as any);
  const { res, state } = createResponseHarness();

  const req: any = {
    params: { id: '44' },
    clubId: 7,
  };

  await controller.getAdminBookingHistory(req, res);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, [{
    id: 'bhe-1',
    bookingId: 44,
    clubId: 7,
    action: 'BOOKING_CREATED',
    category: 'BOOKING',
    source: 'ADMIN',
    summary: 'Reserva creada',
    occurredAt: new Date('2026-05-21T20:00:00.000Z'),
    actorUserId: 18,
    actorLabel: 'Admin Las Tejas',
    detail: { amount: 10000 },
    previousState: null,
    nextState: { status: 'PENDING' },
    bookingParticipantId: null,
    paymentId: null,
    accountId: null,
    metadata: null,
  }]);
});

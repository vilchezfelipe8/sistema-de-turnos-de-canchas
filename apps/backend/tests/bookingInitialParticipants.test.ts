import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingController } from '../src/controllers/BookingController';
import { BookingService } from '../src/services/BookingService';
import { prisma } from '../src/prisma';

function buildRes() {
  const payload: any = { statusCode: 200, body: null };
  const res: any = {
    status(code: number) {
      payload.statusCode = code;
      return res;
    },
    json(body: any) {
      payload.body = body;
      return res;
    }
  };
  return { res, payload };
}

test('checkout entrega los participantes iniciales sanitizados al crear la reserva', async () => {
  let receivedOptions: any = null;
  const controller = new BookingController({
    createBooking: async (...args: any[]) => {
      receivedOptions = args[6];
      return { id: 901, status: 'CONFIRMED' };
    }
  } as any);
  const originalCourtFindUnique = (prisma.court as any).findUnique;
  (prisma.court as any).findUnique = async () => ({
    id: 10,
    club: {
      country: 'AR',
      settings: { timeZone: 'America/Argentina/Buenos_Aires' }
    }
  });

  const req: any = {
    body: {
      courtId: 10,
      activityId: 20,
      startDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      initialParticipants: [
        { email: ' invitado@example.com ', name: ' Leo ' },
        { dni: '35.123.456' }
      ]
    },
    user: { userId: 77, role: 'CUSTOMER' },
    membershipRole: 'CUSTOMER',
    authState: 'authenticated'
  };
  const { res, payload } = buildRes();

  try {
    await controller.createBooking(req, res);
  } finally {
    (prisma.court as any).findUnique = originalCourtFindUnique;
  }

  assert.equal(payload.statusCode, 201);
  assert.deepEqual(receivedOptions.initialParticipants, [
    { email: 'invitado@example.com', dni: null, name: 'Leo' },
    { email: null, dni: '35.123.456', name: null }
  ]);
});

test('la misma regla de invitación crea el participante y ocupa su lugar', async () => {
  const service = new BookingService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any) as any;
  let assignedParticipantId = '';
  let historyCreated = false;
  service.playerSlotService = {
    assertHasFreeSlotTx: async () => undefined,
    assignParticipantTx: async (_tx: any, input: any) => {
      assignedParticipantId = input.participantId;
    }
  };
  service.appendBookingHistoryEntryTx = async () => {
    historyCreated = true;
  };
  const tx: any = {
    user: { findUnique: async () => null },
    bookingParticipant: {
      findMany: async () => [],
      create: async ({ data }: any) => ({
        ...data,
        id: 'participant-1',
        user: null
      })
    },
    client: { findFirst: async () => null },
    auditLog: { create: async () => ({}) }
  };

  const participant = await service.createPlayerBookingInvitationTx(tx, {
    bookingId: 501,
    clubId: 10,
    ownerUserId: 77,
    ownerEmail: 'owner@example.com',
    invitedEmail: 'guest@example.com',
    invitedName: 'Guest'
  });

  assert.equal(participant.status, 'INVITED');
  assert.equal(participant.invitedEmail, 'guest@example.com');
  assert.equal(assignedParticipantId, 'participant-1');
  assert.equal(historyCreated, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingController } from '../src/controllers/BookingController';
import { CashController } from '../src/controllers/CashController';
import { prisma } from '../src/prisma';

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

test('booking registra incidente cuando detecta CLIENT_POSSIBLE_DUPLICATE', async () => {
  const controller = new BookingController({
    createBooking: async () => {
      const error: any = new Error('CLIENT_POSSIBLE_DUPLICATE');
      error.code = 'CLIENT_POSSIBLE_DUPLICATE';
      error.details = {
        clubId: 5,
        candidateClientIds: ['c-1', 'c-2'],
        reasonType: 'MULTI_SIGNAL_CONFLICT',
        signals: { phone: '+5493511234567' }
      };
      throw error;
    }
  } as any);

  let registeredPayload: any = null;
  (controller as any).duplicateIncidentService = {
    createOrReuseIncident: async (payload: any) => {
      registeredPayload = payload;
      return { id: 'inc-1' };
    }
  };

  const originalCourtFindUnique = (prisma as any).court.findUnique;
  (prisma as any).court.findUnique = async (args: any) => {
    if (args?.select?.clubId) return { clubId: 5 };
    return {
      id: 10,
      club: {
        country: 'AR',
        settings: {
          timeZone: 'America/Argentina/Cordoba'
        }
      }
    };
  };

  const req: any = {
    body: {
      courtId: 10,
      startDateTime: '2026-04-10T13:00:00.000Z',
      activityId: 20
    },
    user: { userId: 77, role: 'CUSTOMER' },
    membershipRole: 'CUSTOMER',
    clubId: 5
  };
  const { res, payload } = buildRes();

  try {
    await controller.createBooking(req, res);
  } finally {
    (prisma as any).court.findUnique = originalCourtFindUnique;
  }

  assert.equal(payload.statusCode, 409);
  assert.equal(payload.body?.error?.includes('podrían corresponder a más de un cliente'), true);
  assert.equal(registeredPayload?.clubId, 5);
  assert.equal(registeredPayload?.sourceType, 'BOOKING');
  assert.deepEqual(registeredPayload?.candidateClientIds, ['c-1', 'c-2']);
});

test('cash registra incidente cuando detecta CLIENT_POSSIBLE_DUPLICATE', async () => {
  const controller = new CashController({
    createProductSale: async () => {
      const error: any = new Error('CLIENT_POSSIBLE_DUPLICATE');
      error.code = 'CLIENT_POSSIBLE_DUPLICATE';
      error.details = {
        clubId: 12,
        candidateClientIds: ['cash-1', 'cash-2'],
        reasonType: 'PHONE',
        signals: { phone: '+34600111222' }
      };
      throw error;
    }
  } as any);

  let registeredPayload: any = null;
  (controller as any).duplicateIncidentService = {
    createOrReuseIncident: async (payload: any) => {
      registeredPayload = payload;
      return { id: 'inc-cash-1' };
    }
  };

  const req: any = {
    body: {
      items: [{ productId: 101, quantity: 1 }],
      method: 'CASH',
      clientId: 'x'
    },
    headers: {},
    clubId: 12,
    user: { userId: 500 }
  };
  const { res, payload } = buildRes();

  await controller.createProductSale(req, res);

  assert.equal(payload.statusCode, 409);
  assert.equal(payload.body?.error, 'CLIENT_POSSIBLE_DUPLICATE');
  assert.equal(registeredPayload?.clubId, 12);
  assert.equal(registeredPayload?.sourceType, 'CASH');
  assert.deepEqual(registeredPayload?.candidateClientIds, ['cash-1', 'cash-2']);
});

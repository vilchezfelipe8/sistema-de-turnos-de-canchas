import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingController } from '../src/controllers/BookingController';
import { CashController } from '../src/controllers/CashController';
import { ClubController } from '../src/controllers/ClubController';
import { prisma } from '../src/prisma';
import { conflict, ErrorCodes } from '../src/errors';

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

  const futureStartDateTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const req: any = {
    body: {
      courtId: 10,
      startDateTime: futureStartDateTime,
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
  assert.equal(payload.body?.code, 'CLIENT_POSSIBLE_DUPLICATE');
  assert.match(String(payload.body?.error || '').toLowerCase(), /podr[ií]an corresponder a m[aá]s de un cliente/);
  assert.equal(registeredPayload?.clubId, 5);
  assert.equal(registeredPayload?.sourceType, 'BOOKING');
  assert.deepEqual(registeredPayload?.candidateClientIds, ['c-1', 'c-2']);
});

test('booking falla por timeZone faltante antes de intentar persistir', async () => {
  let createBookingCalls = 0;
  const controller = new BookingController({
    createBooking: async () => {
      createBookingCalls += 1;
      return { id: 999 };
    }
  } as any);

  const originalCourtFindUnique = (prisma as any).court.findUnique;
  (prisma as any).court.findUnique = async () => ({
    id: 10,
    club: {
      country: 'AR',
      settings: {
        timeZone: ''
      }
    }
  });

  const futureStartDateTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const req: any = {
    body: {
      courtId: 10,
      startDateTime: futureStartDateTime,
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

  assert.equal(payload.statusCode, 400);
  assert.equal(payload.body?.code, 'CLUB_CONFIG_INVALID');
  assert.equal(createBookingCalls, 0);
});

test('booking no valida timeZone después de crear (sin error tardío post-write)', async () => {
  let createBookingCalls = 0;
  const controller = new BookingController({
    createBooking: async () => {
      createBookingCalls += 1;
      return { id: 1001, status: 'PENDING' };
    }
  } as any);

  let courtLookupCalls = 0;
  const originalCourtFindUnique = (prisma as any).court.findUnique;
  (prisma as any).court.findUnique = async () => {
    courtLookupCalls += 1;
    if (courtLookupCalls === 1) {
      return {
        id: 10,
        club: {
          country: 'AR',
          settings: {
            timeZone: 'America/Argentina/Cordoba'
          }
        }
      };
    }
    return {
      id: 10,
      club: {
        country: 'AR',
        settings: {
          timeZone: ''
        }
      }
    };
  };

  const futureStartDateTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const req: any = {
    body: {
      courtId: 10,
      startDateTime: futureStartDateTime,
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

  assert.equal(payload.statusCode, 201);
  assert.equal(createBookingCalls, 1);
  assert.equal(courtLookupCalls, 1);
});

test('cash registra incidente cuando detecta CLIENT_POSSIBLE_DUPLICATE', async () => {
  const controller = new CashController({
    createProductSale: async () => {
      throw conflict(
        'Se encontraron posibles clientes duplicados.',
        ErrorCodes.CLIENT_POSSIBLE_DUPLICATE,
        {
          clubId: 12,
          candidateClientIds: ['cash-1', 'cash-2'],
          reasonType: 'PHONE',
          signals: { phone: '+34600111222' }
        }
      );
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
  assert.equal(payload.body?.code, ErrorCodes.CLIENT_POSSIBLE_DUPLICATE);
  assert.equal(registeredPayload?.clubId, 12);
  assert.equal(registeredPayload?.sourceType, 'CASH');
  assert.deepEqual(registeredPayload?.candidateClientIds, ['cash-1', 'cash-2']);
});

test('alta de cliente admin registra incidente cuando detecta CLIENT_POSSIBLE_DUPLICATE', async () => {
  const controller = new ClubController({
    createClient: async () => {
      throw conflict(
        'Ya existen clientes con datos similares. Revisá antes de crear uno nuevo.',
        ErrorCodes.CLIENT_POSSIBLE_DUPLICATE,
        {
          primaryClientId: 'client-1',
          candidateClientIds: ['client-1', 'client-2'],
          reasonType: 'PHONE',
          signals: ['PHONE']
        }
      );
    }
  } as any);

  let registeredPayload: any = null;
  (controller as any).duplicateIncidentService = {
    createOrReuseIncident: async (payload: any) => {
      registeredPayload = payload;
      return { id: 'inc-admin-1' };
    }
  };

  const req: any = {
    body: {
      name: 'Juan Nuevo',
      phone: '+5493511111111',
      phoneCountryCode: 'AR',
      phoneNumberLocal: '3511111111',
      email: 'familia@pique.test',
      dni: '',
      isProfessor: false
    },
    user: { userId: 321 },
    club: {
      id: 5,
      country: 'AR'
    }
  };
  const { res, payload } = buildRes();

  await controller.createClubClient(req, res);

  assert.equal(payload.statusCode, 409);
  assert.equal(payload.body?.code, ErrorCodes.CLIENT_POSSIBLE_DUPLICATE);
  assert.equal(registeredPayload?.clubId, 5);
  assert.equal(registeredPayload?.sourceType, 'ADMIN');
  assert.equal(registeredPayload?.reasonType, 'PHONE');
  assert.deepEqual(registeredPayload?.candidateClientIds, ['client-1', 'client-2']);
});

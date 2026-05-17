import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingService } from '../src/services/BookingService';
import { prisma } from '../src/prisma';
import { AppError, ErrorCodes } from '../src/errors';

function createService() {
  const service = new BookingService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any) as any;
  (service as any).accountService = {
    calculateNetPaidAmountTx: async () => 2000
  };
  (service as any).clubPaymentIntegrationService = {
    getMercadoPagoAccessTokenForClub: async () => 'mp-access-token'
  };
  (service as any).mercadoPagoService = {
    createPreference: async () => ({
      id: 'pref-1',
      init_point: 'https://mp.example.test/init-point'
    })
  };
  return service as any;
}

function baseBooking(overrides?: Partial<Record<string, any>>) {
  return {
    id: 801,
    displayCode: 'RES-801',
    startDateTime: new Date('2026-08-20T21:00:00.000Z'),
    endDateTime: new Date('2026-08-20T22:00:00.000Z'),
    status: 'CONFIRMED',
    userId: 77,
    clubId: 10,
    court: {
      name: 'Cancha 1',
      club: {
        id: 10,
        name: 'Club Norte',
        slug: 'club-norte'
      }
    },
    client: {
      userId: null,
      name: 'Titular',
      email: 'owner@club.com'
    },
    user: {
      firstName: 'Ada',
      lastName: 'Owner',
      email: 'owner@club.com'
    },
    participants: [],
    ...overrides
  };
}

function baseAccount(overrides?: Partial<Record<string, any>>) {
  return {
    id: 'acc-booking-801',
    clubId: 10,
    status: 'OPEN',
    totalAmount: 8000,
    refunds: [],
    items: [],
    ...overrides
  };
}

async function withPrismaMocks(
  mocks: Partial<Record<string, any>>,
  run: () => Promise<void>
) {
  const original = {
    bookingFindUnique: (prisma.booking as any).findUnique,
    accountFindFirst: (prisma.account as any).findFirst,
    paymentCreate: (prisma.payment as any).create,
    cashMovementCreate: (prisma.cashMovement as any).create,
    transaction: (prisma as any).$transaction
  };

  if (mocks.bookingFindUnique) (prisma.booking as any).findUnique = mocks.bookingFindUnique;
  if (mocks.accountFindFirst) (prisma.account as any).findFirst = mocks.accountFindFirst;
  if (mocks.paymentCreate) (prisma.payment as any).create = mocks.paymentCreate;
  if (mocks.cashMovementCreate) (prisma.cashMovement as any).create = mocks.cashMovementCreate;
  if (mocks.transaction) (prisma as any).$transaction = mocks.transaction;

  try {
    await run();
  } finally {
    (prisma.booking as any).findUnique = original.bookingFindUnique;
    (prisma.account as any).findFirst = original.accountFindFirst;
    (prisma.payment as any).create = original.paymentCreate;
    (prisma.cashMovement as any).create = original.cashMovementCreate;
    (prisma as any).$transaction = original.transaction;
  }
}

test('titular crea intento Mercado Pago sin crear Payment ni CashMovement', async () => {
  const service = createService();
  let createdAttempt: any = null;
  let updatedAttempt: any = null;
  let preferenceInput: any = null;
  let preferenceCalled = false;
  let paymentCreated = false;
  let cashMovementCreated = false;

  await withPrismaMocks(
    {
      bookingFindUnique: async () => baseBooking(),
      accountFindFirst: async () => baseAccount(),
      paymentCreate: async () => {
        paymentCreated = true;
        return null;
      },
      cashMovementCreate: async () => {
        cashMovementCreated = true;
        return null;
      },
      transaction: async (callback: any) =>
        callback({
          $queryRaw: async () => [{ id: 'acc-booking-801' }],
          account: {
            findUnique: async () => baseAccount()
          },
          onlinePaymentAttempt: {
            findFirst: async () => null,
            create: async ({ data }: any) => {
              createdAttempt = data;
              return { id: 'attempt-1' };
            },
            update: async ({ data }: any) => {
              updatedAttempt = data;
              return {};
            }
          },
          clubPaymentIntegration: {
            findUnique: async () => ({ id: 'integration-1' })
          },
          auditLog: {
            create: async () => ({})
          }
        })
    },
    async () => {
      (service as any).mercadoPagoService.createPreference = async (input: any) => {
        preferenceCalled = true;
        preferenceInput = input;
        return {
          id: 'pref-1',
          init_point: 'https://mp.example.test/init-point'
        };
      };

      const result = await service.createPlayerMercadoPagoCheckoutAttempt(801, 77);

      assert.equal(result.attemptId, 'attempt-1');
      assert.equal(result.provider, 'MERCADO_PAGO');
      assert.equal(result.initPoint, 'https://mp.example.test/init-point');
      assert.equal(createdAttempt.amount, 6000);
      assert.equal(createdAttempt.provider, 'MERCADO_PAGO');
      assert.match(createdAttempt.idempotencyKey, /booking:801:user:77:pending:6000\.00/);
      assert.equal(updatedAttempt.status, 'PENDING');
      assert.equal(preferenceCalled, true);
      assert.equal(preferenceInput.title, 'Reserva de cancha - Club Norte');
      assert.equal(preferenceInput.description, 'Cancha 1 · Club Norte');
      assert.equal(paymentCreated, false);
      assert.equal(cashMovementCreated, false);
    }
  );
});

test('participante no puede iniciar pago online', async () => {
  const service = createService();

  await withPrismaMocks(
    {
      bookingFindUnique: async () =>
        baseBooking({
          userId: 99,
          participants: [{ userId: 77, status: 'JOINED' }]
        })
    },
    async () => {
      await assert.rejects(
        () => service.createPlayerMercadoPagoCheckoutAttempt(801, 77),
        (error: any) => error instanceof AppError && error.code === ErrorCodes.CHECKOUT_FORBIDDEN
      );
    }
  );
});

test('sin provider conectado bloquea el intento de checkout', async () => {
  const service = createService();
  (service as any).clubPaymentIntegrationService.getMercadoPagoAccessTokenForClub = async () => null;

  await withPrismaMocks(
    {
      bookingFindUnique: async () => baseBooking(),
      accountFindFirst: async () => baseAccount()
    },
    async () => {
      await assert.rejects(
        () => service.createPlayerMercadoPagoCheckoutAttempt(801, 77),
        (error: any) => error instanceof AppError && error.code === ErrorCodes.CHECKOUT_PROVIDER_NOT_CONFIGURED
      );
    }
  );
});

test('si no hay saldo pendiente bloquea el intento', async () => {
  const service = createService();
  (service as any).accountService.calculateNetPaidAmountTx = async () => 8000;

  await withPrismaMocks(
    {
      bookingFindUnique: async () => baseBooking(),
      accountFindFirst: async () => baseAccount(),
      transaction: async (callback: any) =>
        callback({
          $queryRaw: async () => [{ id: 'acc-booking-801' }],
          account: {
            findUnique: async () => baseAccount()
          }
        })
    },
    async () => {
      await assert.rejects(
        () => service.createPlayerMercadoPagoCheckoutAttempt(801, 77),
        (error: any) => error instanceof AppError && error.code === ErrorCodes.CHECKOUT_NO_PENDING_BALANCE
      );
    }
  );
});

test('si ya existe un intento pendiente reutiliza el initPoint y evita duplicar', async () => {
  const service = createService();
  let createCalled = false;
  let preferenceCalled = false;

  await withPrismaMocks(
    {
      bookingFindUnique: async () => baseBooking(),
      accountFindFirst: async () => baseAccount(),
      transaction: async (callback: any) =>
        callback({
          $queryRaw: async () => [{ id: 'acc-booking-801' }],
          account: {
            findUnique: async () => baseAccount()
          },
          onlinePaymentAttempt: {
            findFirst: async () => ({
              id: 'attempt-existing',
              amount: 6000,
              initPoint: 'https://mp.example.test/existing',
              status: 'PENDING'
            }),
            create: async () => {
              createCalled = true;
              return { id: 'attempt-new' };
            }
          }
        })
    },
    async () => {
      (service as any).mercadoPagoService.createPreference = async () => {
        preferenceCalled = true;
        return { id: 'pref-1', init_point: 'https://mp.example.test/new' };
      };

      const result = await service.createPlayerMercadoPagoCheckoutAttempt(801, 77);
      assert.equal(result.attemptId, 'attempt-existing');
      assert.equal(result.initPoint, 'https://mp.example.test/existing');
      assert.equal(createCalled, false);
      assert.equal(preferenceCalled, false);
    }
  );
});

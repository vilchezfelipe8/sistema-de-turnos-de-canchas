import test from 'node:test';
import assert from 'node:assert/strict';
import { OnlineCheckoutService } from '../src/services/OnlineCheckoutService';
import { prisma } from '../src/prisma';
import { AppError, ErrorCodes } from '../src/errors';

function createService() {
  const service = new OnlineCheckoutService() as any;
  service.mercadoPagoService = {
    validateWebhookSignature: () => true,
    getPayment: async () => ({
      id: 'mp-payment-1',
      status: 'approved',
      transaction_amount: 6000,
      payment_type_id: 'account_money',
      external_reference: 'attempt-1'
    })
  };
  service.clubPaymentIntegrationService = {
    getMercadoPagoAccessTokenForClub: async () => 'club-access-token'
  };
  service.paymentService = {
    createInTransaction: async (_tx: any, input: any) => ({
      id: 'payment-1',
      source: input.source
    })
  };
  service.accountService = {
    reconcilePaidAmountTx: async () => ({ remaining: 6000 })
  };
  return service as any;
}

async function withTransactionMock(
  transactionImpl: any,
  run: () => Promise<void>
) {
  const original = (prisma as any).$transaction;
  (prisma as any).$transaction = transactionImpl;
  try {
    await run();
  } finally {
    (prisma as any).$transaction = original;
  }
}

test('webhook inválido se bloquea antes de consultar el pago', async () => {
  const service = createService();
  (service as any).mercadoPagoService.validateWebhookSignature = () => false;

  await assert.rejects(
    () => service.processMercadoPagoWebhook({
      clubId: 10,
      attemptId: 'attempt-1',
      paymentId: 'mp-payment-1',
      xSignature: 'bad',
      xRequestId: 'req-1'
    }),
    (error: any) => error instanceof AppError && error.code === ErrorCodes.ONLINE_PAYMENT_WEBHOOK_INVALID
  );
});

test('webhook aprobado crea un Payment una sola vez y es idempotente', async () => {
  const service = createService();
  let paymentCreated = 0;
  let createdPaymentInput: any = null;
  const attemptState: any = {
    id: 'attempt-1',
    clubId: 10,
    userId: 77,
    accountId: 'acc-booking-1',
    bookingId: 801,
    amount: 6000,
    status: 'PENDING',
    paymentId: null
  };

  (service as any).paymentService.createInTransaction = async (_tx: any, input: any) => {
    paymentCreated += 1;
    createdPaymentInput = input;
    return { id: 'payment-1' };
  };

  await withTransactionMock(
    async (callback: any) =>
      callback({
        $queryRaw: async () => [{ id: 'attempt-1' }],
        onlinePaymentAttempt: {
          findUnique: async () => attemptState,
          update: async ({ data }: any) => {
            Object.assign(attemptState, data);
            return { ...attemptState };
          }
        },
        account: {
          findUnique: async () => ({
            id: 'acc-booking-1',
            refunds: []
          })
        },
        auditLog: {
          create: async () => ({})
        }
      }),
    async () => {
      const first = await service.processMercadoPagoWebhook({
        clubId: 10,
        attemptId: 'attempt-1',
        paymentId: 'mp-payment-1',
        xSignature: 'sig',
        xRequestId: 'req-1'
      });

      const second = await service.processMercadoPagoWebhook({
        clubId: 10,
        attemptId: 'attempt-1',
        paymentId: 'mp-payment-1',
        xSignature: 'sig',
        xRequestId: 'req-1'
      });

      assert.equal(first.status, 'APPROVED');
      assert.equal(paymentCreated, 1);
      assert.equal(createdPaymentInput.source, 'ONLINE');
      assert.equal(second.alreadyProcessed, true);
      assert.equal(attemptState.status, 'APPROVED');
      assert.equal(attemptState.paymentId, 'payment-1');
    }
  );
});

test('webhook rechazado no crea Payment', async () => {
  const service = createService();
  let paymentCreated = false;
  const attemptState: any = {
    id: 'attempt-1',
    clubId: 10,
    userId: 77,
    accountId: 'acc-booking-1',
    bookingId: 801,
    amount: 6000,
    status: 'PENDING',
    paymentId: null
  };

  (service as any).mercadoPagoService.getPayment = async () => ({
    id: 'mp-payment-2',
    status: 'rejected',
    transaction_amount: 6000,
    payment_type_id: 'account_money',
    external_reference: 'attempt-1'
  });
  (service as any).paymentService.createInTransaction = async () => {
    paymentCreated = true;
    return { id: 'payment-1' };
  };

  await withTransactionMock(
    async (callback: any) =>
      callback({
        $queryRaw: async () => [{ id: 'attempt-1' }],
        onlinePaymentAttempt: {
          findUnique: async () => attemptState,
          update: async ({ data }: any) => {
            Object.assign(attemptState, data);
            return { ...attemptState };
          }
        },
        auditLog: {
          create: async () => ({})
        }
      }),
    async () => {
      const result = await service.processMercadoPagoWebhook({
        clubId: 10,
        attemptId: 'attempt-1',
        paymentId: 'mp-payment-2',
        xSignature: 'sig',
        xRequestId: 'req-1'
      });

      assert.equal(result.status, 'REJECTED');
      assert.equal(paymentCreated, false);
      assert.equal(attemptState.status, 'REJECTED');
    }
  );
});

test('amount mismatch deja el intento en error y no crea Payment', async () => {
  const service = createService();
  let paymentCreated = false;
  const attemptState: any = {
    id: 'attempt-1',
    clubId: 10,
    userId: 77,
    accountId: 'acc-booking-1',
    bookingId: 801,
    amount: 6000,
    status: 'PENDING',
    paymentId: null
  };

  (service as any).mercadoPagoService.getPayment = async () => ({
    id: 'mp-payment-3',
    status: 'approved',
    transaction_amount: 7000,
    payment_type_id: 'account_money',
    external_reference: 'attempt-1'
  });
  (service as any).paymentService.createInTransaction = async () => {
    paymentCreated = true;
    return { id: 'payment-1' };
  };

  await withTransactionMock(
    async (callback: any) =>
      callback({
        $queryRaw: async () => [{ id: 'attempt-1' }],
        onlinePaymentAttempt: {
          findUnique: async () => attemptState,
          update: async ({ data }: any) => {
            Object.assign(attemptState, data);
            return { ...attemptState };
          }
        },
        auditLog: {
          create: async () => ({})
        }
      }),
    async () => {
      const result = await service.processMercadoPagoWebhook({
        clubId: 10,
        attemptId: 'attempt-1',
        paymentId: 'mp-payment-3',
        xSignature: 'sig',
        xRequestId: 'req-1'
      });

      assert.equal(result.reason, ErrorCodes.CHECKOUT_AMOUNT_CHANGED);
      assert.equal(paymentCreated, false);
      assert.equal(attemptState.status, 'ERROR');
    }
  );
});

test('cuenta ya pagada bloquea el webhook aprobado y no duplica cobro', async () => {
  const service = createService();
  let paymentCreated = false;
  const attemptState: any = {
    id: 'attempt-1',
    clubId: 10,
    userId: 77,
    accountId: 'acc-booking-1',
    bookingId: 801,
    amount: 6000,
    status: 'PENDING',
    paymentId: null
  };

  (service as any).accountService.reconcilePaidAmountTx = async () => ({ remaining: 0 });
  (service as any).paymentService.createInTransaction = async () => {
    paymentCreated = true;
    return { id: 'payment-1' };
  };

  await withTransactionMock(
    async (callback: any) =>
      callback({
        $queryRaw: async () => [{ id: 'attempt-1' }],
        onlinePaymentAttempt: {
          findUnique: async () => attemptState,
          update: async ({ data }: any) => {
            Object.assign(attemptState, data);
            return { ...attemptState };
          }
        },
        account: {
          findUnique: async () => ({
            id: 'acc-booking-1',
            refunds: []
          })
        },
        auditLog: {
          create: async () => ({})
        }
      }),
    async () => {
      const result = await service.processMercadoPagoWebhook({
        clubId: 10,
        attemptId: 'attempt-1',
        paymentId: 'mp-payment-1',
        xSignature: 'sig',
        xRequestId: 'req-1'
      });

      assert.equal(result.reason, ErrorCodes.CHECKOUT_ALREADY_PAID);
      assert.equal(paymentCreated, false);
      assert.equal(attemptState.status, 'ERROR');
    }
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionService, initialPurchaseInstallments } from '../src/services/subscriptions/SubscriptionService';
import { describeEntitlement } from '../src/services/subscriptions/PlayerSubscriptionService';
import { OnlineCheckoutService } from '../src/services/OnlineCheckoutService';
import { prisma } from '../src/prisma';
import { pushNotificationService } from '../src/services/PushNotificationService';

const d = (key: string) => new Date(`${key}T00:00:00.000Z`);

test('compra online: se paga la matrícula y la primera cuota (no las demás ni las anuladas)', () => {
  const rows = [
    { id: 'p2', kind: 'PERIOD' as const, sequence: 2, status: 'PENDING' },
    { id: 'fee', kind: 'ENROLLMENT_FEE' as const, sequence: 0, status: 'PENDING' },
    { id: 'p1', kind: 'PERIOD' as const, sequence: 1, status: 'PENDING' },
    { id: 'p3', kind: 'PERIOD' as const, sequence: 3, status: 'PENDING' },
  ];
  assert.deepEqual(initialPurchaseInstallments(rows).map((row) => row.id), ['fee', 'p1']);
  assert.deepEqual(
    initialPurchaseInstallments(rows.map((row) => (row.id === 'fee' ? { ...row, status: 'VOID' } : row))).map((row) => row.id),
    ['p1']
  );
});

test('qué incluye un plan, en palabras', () => {
  assert.equal(describeEntitlement({ kind: 'ACTIVITY_ACCESS', timesPerWeek: null, creditsPerPeriod: null, activityType: { name: 'Musculación' } }), 'Musculación libre');
  assert.equal(describeEntitlement({ kind: 'ACTIVITY_ACCESS', timesPerWeek: 3, creditsPerPeriod: null, activityType: { name: 'Funcional' } }), 'Funcional 3 veces por semana');
  assert.equal(
    describeEntitlement({ kind: 'CLASS_CREDITS', timesPerWeek: null, creditsPerPeriod: 8, classType: 'GROUP', activityType: { name: 'Zumba' } }),
    '8 clases grupales de Zumba por mes'
  );
});

function buildTx(options: { enrollmentStatus: 'PENDING' | 'PAID' | null; awaiting: boolean }) {
  const calls: Record<string, any[]> = { subscriptionUpdate: [], history: [], passes: [], push: [] };
  const periodStatus = { value: 'PENDING' as 'PENDING' | 'PAID' };
  const installments = () => [
    ...(options.enrollmentStatus
      ? [{ id: 'fee', sequence: 0, kind: 'ENROLLMENT_FEE', coversFrom: d('2026-11-19'), coversTo: d('2026-11-19'), dueDate: d('2026-11-19'), status: options.enrollmentStatus }]
      : []),
    { id: 'p1', sequence: 1, kind: 'PERIOD', coversFrom: d('2026-11-19'), coversTo: d('2026-12-18'), dueDate: d('2026-11-19'), status: periodStatus.value },
  ];
  const subscription = {
    id: 'sub-1',
    clubId: 7,
    clientId: 'client-1',
    payerClientId: 'client-1',
    status: 'ACTIVE',
    awaitingOnlinePayment: options.awaiting,
    createdByUserId: 55,
    startDate: d('2026-11-19'),
    planSnapshot: {
      planName: 'Mensual',
      graceDays: 0,
      entitlements: [
        { kind: 'CLASS_CREDITS', activityTypeId: 3, activityTypeName: 'Funcional', timesPerWeek: null, creditsPerPeriod: 8, classType: 'GROUP' },
      ],
    },
  };
  const tx: any = {
    $executeRaw: async () => 0,
    account: {
      findUnique: async () => ({ id: 'acc-p1', clubId: 7, sourceType: 'SUBSCRIPTION_INSTALLMENT', sourceId: 'p1', status: 'CLOSED', totalAmount: 55000, paidAmount: 55000 }),
    },
    subscriptionInstallment: {
      findUnique: async () => ({ ...installments().find((row) => row.id === 'p1'), subscriptionId: 'sub-1', subscription }),
      update: async (args: any) => {
        periodStatus.value = args.data.status;
        return {};
      },
      findMany: async () => installments(),
    },
    subscriptionHistory: { create: async (args: any) => calls.history.push(args.data) },
    subscription: {
      update: async (args: any) => calls.subscriptionUpdate.push(args.data),
      findUnique: async () => ({
        ...subscription,
        installments: installments(),
        plan: { name: 'Mensual', grantsMemberCategoryId: null },
        client: { userId: 55, name: 'Ana' },
      }),
      findMany: async () => [],
    },
    clubSettings: { findUnique: async () => ({ timeZone: 'America/Argentina/Buenos_Aires' }) },
    clubMember: { findUnique: async () => null },
    membership: { findMany: async () => [{ userId: 1 }, { userId: 55 }] },
    classPass: {
      findFirst: async () => null,
      findMany: async () => [],
      create: async (args: any) => {
        calls.passes.push(args.data);
        return { id: `pass-${calls.passes.length}` };
      },
    },
  };
  return { tx, calls };
}

async function withPushMock(calls: Record<string, any[]>, run: () => Promise<void>) {
  const original = pushNotificationService.enqueue;
  (pushNotificationService as any).enqueue = async (_db: any, input: any) => {
    calls.push.push(input);
  };
  try {
    await run();
  } finally {
    (pushNotificationService as any).enqueue = original;
  }
}

test('compra online: al pagar la primera cuota se habilita el plan y se avisa al club', async () => {
  const service = new SubscriptionService() as any;
  const granted: any[] = [];
  service.grantPlanClassPassesTx = async (_tx: any, input: any) => granted.push(input);
  const { tx, calls } = buildTx({ enrollmentStatus: null, awaiting: true });
  await withPushMock(calls, () => service.syncInstallmentFromAccountTx(tx, 'acc-p1'));

  assert.deepEqual(calls.subscriptionUpdate, [{ awaitingOnlinePayment: false }]);
  assert.ok(calls.history.some((row) => row.action === 'ONLINE_PURCHASE_PAID'));
  assert.equal(granted.length, 1);
  assert.equal(granted[0].coverageStart, '2026-11-19');
  assert.equal(granted[0].coverageEnd, '2026-12-18');
  // Avisa al staff, no al propio jugador aunque sea del club.
  assert.deepEqual(calls.push.map((row) => row.userId), [1]);
});

test('compra online: con la matrícula sin pagar todavía no se habilita', async () => {
  const service = new SubscriptionService() as any;
  const granted: any[] = [];
  service.grantPlanClassPassesTx = async (_tx: any, input: any) => granted.push(input);
  const { tx, calls } = buildTx({ enrollmentStatus: 'PENDING', awaiting: true });
  await withPushMock(calls, () => service.syncInstallmentFromAccountTx(tx, 'acc-p1'));

  assert.equal(calls.subscriptionUpdate.length, 0);
  assert.equal(granted.length, 0);
  assert.ok(!calls.history.some((row) => row.action === 'ONLINE_PURCHASE_PAID'));
});

test('plan vendido en el club: pagar la cuota no vuelve a dar beneficios', async () => {
  const service = new SubscriptionService() as any;
  const granted: any[] = [];
  service.grantPlanClassPassesTx = async (_tx: any, input: any) => granted.push(input);
  const { tx, calls } = buildTx({ enrollmentStatus: null, awaiting: false });
  await withPushMock(calls, () => service.syncInstallmentFromAccountTx(tx, 'acc-p1'));
  assert.equal(granted.length, 0);
  assert.equal(calls.push.length, 0);
});

test('webhook: un pago por matrícula + primera cuota se reparte entre las dos cuentas', async () => {
  const service = new OnlineCheckoutService() as any;
  service.mercadoPagoService = {
    validateWebhookSignature: () => true,
    getPayment: async () => ({ id: 'mp-9', status: 'approved', transaction_amount: 65000, payment_type_id: 'account_money', external_reference: 'att-1' }),
  };
  service.clubPaymentIntegrationService = { getMercadoPagoAccessTokenForClub: async () => 'token' };
  const payments: any[] = [];
  service.paymentService = {
    createInTransaction: async (_tx: any, input: any) => {
      payments.push(input);
      return { id: `pay-${input.accountId}` };
    },
  };
  service.accountService = {
    reconcilePaidAmountTx: async (_tx: any, accountId: string) => ({ remaining: accountId === 'acc-fee' ? 10000 : 55000 }),
  };
  const attempt: any = {
    id: 'att-1',
    clubId: 7,
    userId: 55,
    accountId: 'acc-p1',
    amount: 65000,
    status: 'PENDING',
    paymentId: null,
    target: { returnTo: 'club', bundle: [{ accountId: 'acc-fee', amount: 10000 }, { accountId: 'acc-p1', amount: 55000 }] },
  };
  const original = (prisma as any).$transaction;
  (prisma as any).$transaction = async (callback: any) =>
    callback({
      $queryRaw: async () => [{ id: 'att-1' }],
      onlinePaymentAttempt: {
        findUnique: async () => attempt,
        update: async ({ data }: any) => Object.assign(attempt, data),
      },
      account: { findUnique: async () => ({ clubId: 7, refunds: [] }) },
      auditLog: { create: async () => ({}) },
    });
  try {
    const result = await service.processMercadoPagoWebhook({ clubId: 7, attemptId: 'att-1', paymentId: 'mp-9', xSignature: 's', xRequestId: 'r' });
    assert.equal(result.status, 'APPROVED');
  } finally {
    (prisma as any).$transaction = original;
  }
  assert.deepEqual(
    payments.map((row) => [row.accountId, row.amount, row.source]),
    [['acc-fee', 10000, 'ONLINE'], ['acc-p1', 55000, 'ONLINE']]
  );
  assert.notEqual(payments[0].idempotencyKey, payments[1].idempotencyKey);
  assert.equal(attempt.status, 'APPROVED');
  assert.equal(attempt.paymentId, 'pay-acc-p1');
});

test('webhook: si una de las cuentas ya no tiene ese saldo, no se imputa nada', async () => {
  const service = new OnlineCheckoutService() as any;
  service.mercadoPagoService = {
    validateWebhookSignature: () => true,
    getPayment: async () => ({ id: 'mp-9', status: 'approved', transaction_amount: 65000, payment_type_id: 'account_money', external_reference: 'att-1' }),
  };
  service.clubPaymentIntegrationService = { getMercadoPagoAccessTokenForClub: async () => 'token' };
  const payments: any[] = [];
  service.paymentService = { createInTransaction: async (_tx: any, input: any) => payments.push(input) };
  // La matrícula ya se cobró en el club.
  service.accountService = { reconcilePaidAmountTx: async (_tx: any, accountId: string) => ({ remaining: accountId === 'acc-fee' ? 0 : 55000 }) };
  const attempt: any = {
    id: 'att-1', clubId: 7, userId: 55, accountId: 'acc-p1', amount: 65000, status: 'PENDING', paymentId: null,
    target: { bundle: [{ accountId: 'acc-fee', amount: 10000 }, { accountId: 'acc-p1', amount: 55000 }] },
  };
  const original = (prisma as any).$transaction;
  (prisma as any).$transaction = async (callback: any) =>
    callback({
      $queryRaw: async () => [{ id: 'att-1' }],
      onlinePaymentAttempt: { findUnique: async () => attempt, update: async ({ data }: any) => Object.assign(attempt, data) },
      account: { findUnique: async () => ({ clubId: 7, refunds: [] }) },
      auditLog: { create: async () => ({}) },
    });
  try {
    const result = await service.processMercadoPagoWebhook({ clubId: 7, attemptId: 'att-1', paymentId: 'mp-9', xSignature: 's', xRequestId: 'r' });
    assert.equal(result.status, 'ERROR');
  } finally {
    (prisma as any).$transaction = original;
  }
  assert.equal(payments.length, 0);
  assert.equal(attempt.status, 'ERROR');
});

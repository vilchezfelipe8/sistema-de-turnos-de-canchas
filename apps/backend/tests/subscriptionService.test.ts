import test from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionService } from '../src/services/subscriptions/SubscriptionService';

const d = (key: string) => new Date(`${key}T00:00:00.000Z`);

function buildTx(options: {
  account: { status: 'OPEN' | 'CLOSED'; totalAmount: number; paidAmount: number };
  installmentStatus: 'PENDING' | 'PAID' | 'VOID';
  subscriptionStatus?: 'ACTIVE' | 'PAST_DUE';
  member?: { validUntil: string | null } | null;
}) {
  const calls: Record<string, any[]> = {
    installmentUpdate: [],
    history: [],
    subscriptionUpdate: [],
    memberUpdate: [],
    memberHistory: [],
  };
  const installmentStatus = { value: options.installmentStatus };
  const subscription = {
    id: 'sub-1',
    clubId: 7,
    clientId: 'client-1',
    status: options.subscriptionStatus ?? 'ACTIVE',
    startDate: d('2026-11-05'),
    planSnapshot: { graceDays: 5, planName: 'Full Pass Trimestral' },
  };
  const installments = () => [
    {
      id: 'inst-1',
      sequence: 1,
      kind: 'PERIOD',
      coversFrom: d('2026-11-05'),
      coversTo: d('2026-12-04'),
      dueDate: d('2026-11-05'),
      status: installmentStatus.value,
    },
    {
      id: 'inst-2',
      sequence: 2,
      kind: 'PERIOD',
      coversFrom: d('2026-12-05'),
      coversTo: d('2027-01-04'),
      dueDate: d('2099-12-10'),
      status: 'PENDING',
    },
  ];

  const tx: any = {
    $executeRaw: async () => 0,
    account: {
      findUnique: async () => ({
        id: 'acc-1',
        clubId: 7,
        sourceType: 'SUBSCRIPTION_INSTALLMENT',
        sourceId: 'inst-1',
        status: options.account.status,
        totalAmount: options.account.totalAmount,
        paidAmount: options.account.paidAmount,
      }),
    },
    subscriptionInstallment: {
      findUnique: async () => ({ ...installments()[0], subscriptionId: 'sub-1', subscription }),
      update: async (args: any) => {
        calls.installmentUpdate.push(args.data);
        installmentStatus.value = args.data.status;
        return {};
      },
      findMany: async () => installments(),
    },
    subscriptionHistory: { create: async (args: any) => calls.history.push(args.data) },
    subscription: {
      update: async (args: any) => calls.subscriptionUpdate.push(args.data),
      findMany: async () => [{ ...subscription, installments: installments() }],
    },
    clubSettings: { findUnique: async () => ({ timeZone: 'America/Argentina/Cordoba' }) },
    clubMember: {
      findUnique: async () =>
        options.member === null
          ? null
          : { id: 'member-1', clubId: 7, validUntil: options.member?.validUntil ? d(options.member.validUntil) : null },
      update: async (args: any) => calls.memberUpdate.push(args.data),
    },
    clubMemberHistory: { create: async (args: any) => calls.memberHistory.push(args.data) },
  };
  return { tx, calls };
}

test('al cerrarse la cuenta de la cuota, la cuota queda paga y el socio al día con gracia', async () => {
  const service = new SubscriptionService();
  const { tx, calls } = buildTx({
    account: { status: 'CLOSED', totalAmount: 45040, paidAmount: 45040 },
    installmentStatus: 'PENDING',
    member: { validUntil: '2026-11-04' },
  });
  await service.syncInstallmentFromAccountTx(tx, 'acc-1');

  assert.equal(calls.installmentUpdate[0].status, 'PAID');
  assert.ok(calls.installmentUpdate[0].paidAt instanceof Date);
  assert.equal(calls.history[0].action, 'INSTALLMENT_PAID');
  // Cubre hasta el 04/12 + 5 días de gracia.
  assert.equal(calls.memberUpdate[0].validUntil.toISOString().slice(0, 10), '2026-12-09');
  assert.equal(calls.memberHistory[0].action, 'VALID_UNTIL_SYNCED');
});

test('pago parcial: la cuota sigue pendiente y no toca nada', async () => {
  const service = new SubscriptionService();
  const { tx, calls } = buildTx({
    account: { status: 'OPEN', totalAmount: 56300, paidAmount: 20000 },
    installmentStatus: 'PENDING',
  });
  await service.syncInstallmentFromAccountTx(tx, 'acc-1');
  assert.equal(calls.installmentUpdate.length, 0);
  assert.equal(calls.memberUpdate.length, 0);
});

test('devolución que reabre la cuenta: la cuota vuelve a pendiente y el socio deja de estar al día', async () => {
  const service = new SubscriptionService();
  const { tx, calls } = buildTx({
    account: { status: 'OPEN', totalAmount: 56300, paidAmount: 0 },
    installmentStatus: 'PAID',
    member: { validUntil: '2026-12-09' },
  });
  await service.syncInstallmentFromAccountTx(tx, 'acc-1');
  assert.equal(calls.installmentUpdate[0].status, 'PENDING');
  assert.equal(calls.installmentUpdate[0].paidAt, null);
  assert.equal(calls.history[0].action, 'INSTALLMENT_REOPENED');
  assert.equal(calls.memberUpdate[0].validUntil.toISOString().slice(0, 10), '2026-11-04');
});

test('pagar la cuota vencida saca al plan de la mora', async () => {
  const service = new SubscriptionService();
  const { tx, calls } = buildTx({
    account: { status: 'CLOSED', totalAmount: 56300, paidAmount: 56300 },
    installmentStatus: 'PENDING',
    subscriptionStatus: 'PAST_DUE',
    member: null,
  });
  await service.syncInstallmentFromAccountTx(tx, 'acc-1');
  assert.equal(calls.subscriptionUpdate[0].status, 'ACTIVE');
  assert.ok(calls.history.some((row) => row.action === 'STATUS_CHANGED' && row.toStatus === 'ACTIVE'));
});

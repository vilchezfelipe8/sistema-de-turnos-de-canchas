import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingService } from '../src/services/BookingService';
import { OnlineCheckoutService } from '../src/services/OnlineCheckoutService';
import { prisma } from '../src/prisma';
import { ErrorCodes } from '../src/errors';

// Pago online en reservas por jugador: cada uno paga su parte y solo se cobran partes con precio
// definitivo (D9: socio sin validar; lugar libre). Ver docs/socios-y-precios-diferenciados.md.

type Slot = {
  slotIndex: number;
  userId: number | null;
  clientId: string | null;
  displayName: string | null;
  isEmpty: boolean;
  memberPricePending: boolean;
  shareAmount: number;
  paidAmount: number;
  accountItemId: string | null;
};

const slot = (overrides: Partial<Slot>): Slot => ({
  slotIndex: 1,
  userId: null,
  clientId: null,
  displayName: null,
  isEmpty: false,
  memberPricePending: false,
  shareAmount: 10000,
  paidAmount: 0,
  accountItemId: null,
  ...overrides
});

const OWNER = 77;
const GUEST = 88;

function serviceWithSlots(slots: Slot[]) {
  const service = new BookingService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any) as any;
  const original = service.playerSlotService.getSlotsTx;
  service.playerSlotService.getSlotsTx = async () => slots;
  service.loadPlayerExtraChargesTx = async () => [];
  return { service, restore: () => { service.playerSlotService.getSlotsTx = original; } };
}

const resolve = (service: any, input: Partial<{ userId: number; isOwner: boolean; scope: string; accountPending: number; perPlayer: boolean }>) =>
  service.resolveOnlinePaymentTargetTx({}, {
    bookingId: 501,
    userId: OWNER,
    isOwner: true,
    scope: 'OWN_SHARE',
    accountPending: 40000,
    perPlayer: true,
    ...input
  });

const fullBooking = () => [
  slot({ slotIndex: 1, userId: OWNER, clientId: 'c-owner', displayName: 'Lionel Messi', accountItemId: 'item-1' }),
  slot({ slotIndex: 2, userId: GUEST, clientId: 'c-guest', displayName: 'Ángel Di María', accountItemId: 'item-2', shareAmount: 7000 })
];

test('reserva por cancha: el pago cubre toda la cuenta, como siempre', async () => {
  const { service } = serviceWithSlots([]);
  const target = await resolve(service, { perPlayer: false });
  assert.equal(target.perPlayer, false);
  assert.equal(target.scope, 'ACCOUNT');
  assert.equal(target.amount, 40000);
  assert.deepEqual(target.items, []);
});

test('el titular paga solo su parte', async () => {
  const { service } = serviceWithSlots(fullBooking());
  const target = await resolve(service, {});
  assert.equal(target.blocked, null);
  assert.equal(target.amount, 10000);
  assert.deepEqual(target.items, [{ accountItemId: 'item-1', amount: 10000 }]);
  assert.equal(target.payer.ref, 'booking-client:c-owner');
});

test('un invitado que aceptó paga su parte (con su precio socio ya aplicado)', async () => {
  const { service } = serviceWithSlots(fullBooking());
  const target = await resolve(service, { userId: GUEST, isOwner: false });
  assert.equal(target.blocked, null);
  assert.equal(target.amount, 7000);
  assert.deepEqual(target.items, [{ accountItemId: 'item-2', amount: 7000 }]);
});

test('lo ya pagado de una parte se descuenta', async () => {
  const slots = fullBooking();
  slots[0].paidAmount = 4000;
  const { service } = serviceWithSlots(slots);
  const target = await resolve(service, {});
  assert.equal(target.amount, 6000);
});

test('un socio sin validar no puede pagar: congelaría su parte a precio no socio', async () => {
  const slots = fullBooking();
  slots[1].memberPricePending = true;
  const { service } = serviceWithSlots(slots);
  const target = await resolve(service, { userId: GUEST, isOwner: false });
  assert.equal(target.blocked, 'MEMBER_PRICE_PENDING');
  assert.deepEqual(target.items, []);
});

test('alguien sin lugar en la reserva no puede pagar', async () => {
  const { service } = serviceWithSlots(fullBooking());
  const target = await resolve(service, { userId: 999, isOwner: false });
  assert.equal(target.blocked, 'NO_PLAYER_SLOT');
});

test('pagar todo solo cuando todos los lugares están ocupados y validados', async () => {
  const withEmpty = [...fullBooking(), slot({ slotIndex: 3, isEmpty: true, accountItemId: 'item-3' })];
  const empty = serviceWithSlots(withEmpty);
  assert.equal((await resolve(empty.service, { scope: 'ALL_SHARES' })).blocked, 'SHARES_NOT_FINAL');

  const pendingMember = fullBooking();
  pendingMember[1].memberPricePending = true;
  const pending = serviceWithSlots(pendingMember);
  assert.equal((await resolve(pending.service, { scope: 'ALL_SHARES' })).blocked, 'SHARES_NOT_FINAL');

  const ready = fullBooking();
  ready[1].paidAmount = 7000; // el invitado ya pagó la suya
  const all = serviceWithSlots(ready);
  const target = await resolve(all.service, { scope: 'ALL_SHARES' });
  assert.equal(target.blocked, null);
  assert.equal(target.amount, 10000);
  assert.deepEqual(target.items, [{ accountItemId: 'item-1', amount: 10000 }]);
});

test('un invitado no puede pagar todas las partes', async () => {
  const { service } = serviceWithSlots(fullBooking());
  const target = await resolve(service, { userId: GUEST, isOwner: false, scope: 'ALL_SHARES' });
  assert.equal(target.blocked, 'NO_PLAYER_SLOT');
});

test('Mis reservas muestra la parte propia y si se puede pagar todo', async () => {
  const slots = fullBooking();
  const { service } = serviceWithSlots(slots);
  const target = await resolve(service, {});
  const view = service.buildPlayerSharesView(target, { userId: OWNER, isOwner: true });
  assert.deepEqual(view.mine, { amount: 10000, paid: 0, pending: 10000, extrasPending: 0, memberPricePending: false });
  assert.equal(view.canPayAll, true);
  assert.equal(view.allPending, 17000);
  assert.equal(view.players.length, 2);
  assert.equal(view.players[0].isMine, true);
  // Del resto se muestra el nombre corto.
  assert.equal(view.players[1].displayName, 'Ángel M.');

  const guestView = service.buildPlayerSharesView(target, { userId: GUEST, isOwner: false });
  assert.equal(guestView.canPayAll, false);
});

test('el titular paga su parte y los consumos sin dueño; el invitado solo la suya', async () => {
  const { service } = serviceWithSlots(fullBooking());
  service.loadPlayerExtraChargesTx = async () => [
    { accountItemId: 'item-gatorade', label: 'Gatorade', pending: 1800, slotIndex: 1 }
  ];
  const owner = await resolve(service, {});
  assert.equal(owner.amount, 11800);
  assert.deepEqual(owner.items, [
    { accountItemId: 'item-1', amount: 10000 },
    { accountItemId: 'item-gatorade', amount: 1800 }
  ]);

  const guest = await resolve(service, { userId: GUEST, isOwner: false });
  assert.equal(guest.amount, 7000);

  const all = await resolve(service, { scope: 'ALL_SHARES' });
  assert.equal(all.amount, 18800);

  const view = service.buildPlayerSharesView(owner, { userId: OWNER, isOwner: true });
  assert.equal(view.mine.pending, 11800);
  assert.equal(view.mine.extrasPending, 1800);
  assert.equal(view.allPending, 18800);
  assert.deepEqual(view.extras, [{ label: 'Gatorade', pending: 1800, slotIndex: 1, isMine: true }]);
});

test('con la parte ya paga, el titular todavía puede pagar los consumos', async () => {
  const slots = fullBooking();
  slots[0].paidAmount = 10000;
  const { service } = serviceWithSlots(slots);
  service.loadPlayerExtraChargesTx = async () => [
    { accountItemId: 'item-gatorade', label: 'Gatorade', pending: 1800, slotIndex: 1 }
  ];
  const owner = await resolve(service, {});
  assert.equal(owner.blocked, null);
  assert.equal(owner.amount, 1800);
  assert.deepEqual(owner.items, [{ accountItemId: 'item-gatorade', amount: 1800 }]);
});

test('los consumos con dueño los paga ese jugador', async () => {
  const { service } = serviceWithSlots(fullBooking());
  service.loadPlayerExtraChargesTx = async () => [
    { accountItemId: 'item-agua', label: 'Agua', pending: 900, slotIndex: 2 }
  ];
  const owner = await resolve(service, {});
  assert.equal(owner.amount, 10000);
  const guest = await resolve(service, { userId: GUEST, isOwner: false });
  assert.equal(guest.amount, 7900);
});

// ── Webhook: imputación del pago a las partes ──

function webhookService(transactionAmount: number) {
  const service = new OnlineCheckoutService() as any;
  service.mercadoPagoService = {
    validateWebhookSignature: () => true,
    getPayment: async () => ({ id: 'mp-1', status: 'approved', transaction_amount: transactionAmount, payment_type_id: 'credit_card' })
  };
  service.clubPaymentIntegrationService = { getMercadoPagoAccessTokenForClub: async () => 'token' };
  service.accountService = { reconcilePaidAmountTx: async () => ({ remaining: 17000 }) };
  return service;
}

async function runWebhook(service: any, attempt: any, items: Array<{ id: string; total: number }>, allocated: Array<{ accountItemId: string; amount: number }>) {
  const original = (prisma as any).$transaction;
  (prisma as any).$transaction = async (callback: any) => callback({
    $queryRaw: async () => [{ id: attempt.id }],
    onlinePaymentAttempt: {
      findUnique: async () => attempt,
      update: async ({ data }: any) => Object.assign(attempt, data)
    },
    account: { findUnique: async () => ({ id: attempt.accountId, refunds: [] }) },
    accountItem: { findMany: async () => items },
    paymentAllocation: { groupBy: async () => allocated.map((row) => ({ accountItemId: row.accountItemId, _sum: { amount: row.amount } })) },
    auditLog: { create: async () => ({}) }
  });
  try {
    return await service.processMercadoPagoWebhook({ clubId: 10, attemptId: attempt.id, paymentId: 'mp-1', xSignature: 's', xRequestId: 'r' });
  } finally {
    (prisma as any).$transaction = original;
  }
}

const shareAttempt = () => ({
  id: 'attempt-share',
  clubId: 10,
  userId: GUEST,
  accountId: 'acc-1',
  bookingId: 501,
  amount: 7000,
  status: 'PENDING',
  paymentId: null as string | null,
  target: { scope: 'OWN_SHARE', items: [{ accountItemId: 'item-2', amount: 7000 }], payer: { ref: 'booking-client:c-guest', name: 'Ángel Di María' } }
});

test('el pago aprobado se imputa a la parte de quien pagó', async () => {
  const service = webhookService(7000);
  let paymentInput: any = null;
  service.paymentService = { createInTransaction: async (_tx: any, input: any) => { paymentInput = input; return { id: 'payment-9' }; } };
  const attempt = shareAttempt();

  const result = await runWebhook(service, attempt, [{ id: 'item-2', total: 7000 }], []);

  assert.equal(result.status, 'APPROVED');
  assert.deepEqual(paymentInput.allocations, [{ accountItemId: 'item-2', amount: 7000 }]);
  assert.equal(paymentInput.payerParticipantRef, 'booking-client:c-guest');
  assert.equal(paymentInput.coveredParticipantRef, 'booking-client:c-guest');
  assert.equal(attempt.status, 'APPROVED');
});

test('si la parte cambió (por ejemplo, ya la cobró el club) el pago no se imputa', async () => {
  const service = webhookService(7000);
  let created = false;
  service.paymentService = { createInTransaction: async () => { created = true; return { id: 'x' }; } };
  const attempt = shareAttempt();

  const result = await runWebhook(service, attempt, [{ id: 'item-2', total: 7000 }], [{ accountItemId: 'item-2', amount: 7000 }]);

  assert.equal(result.status, 'ERROR');
  assert.equal(result.reason, ErrorCodes.CHECKOUT_AMOUNT_CHANGED);
  assert.equal(created, false);
});

test('un pago de toda la cuenta (por cancha) sigue sin imputaciones explícitas', async () => {
  const service = webhookService(7000);
  let paymentInput: any = null;
  service.paymentService = { createInTransaction: async (_tx: any, input: any) => { paymentInput = input; return { id: 'payment-10' }; } };
  const attempt: any = { ...shareAttempt(), target: null };

  const result = await runWebhook(service, attempt, [], []);

  assert.equal(result.status, 'APPROVED');
  assert.equal(paymentInput.allocations, undefined);
});

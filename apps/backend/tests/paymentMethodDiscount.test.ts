import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PaymentMethodDiscountService,
  getPaymentMethodDiscountPercent,
  normalizePaymentMethodDiscounts,
  splitAllocationsWithDiscount
} from '../src/services/PaymentMethodDiscountService';

test('normaliza la config: ignora basura, negativos y topea en 90%', () => {
  assert.deepEqual(normalizePaymentMethodDiscounts(null), { CASH: 0, TRANSFER: 0, CARD: 0, ONLINE: 0 });
  assert.deepEqual(normalizePaymentMethodDiscounts({ CASH: '20', TRANSFER: -5, CARD: 150, OTHER: 30 }), { CASH: 20, TRANSFER: 0, CARD: 90, ONLINE: 0 });
  assert.equal(getPaymentMethodDiscountPercent({ CASH: 20, TRANSFER: 0, CARD: 0, ONLINE: 0 }, 'CASH'), 20);
  assert.equal(getPaymentMethodDiscountPercent({ CASH: 20, TRANSFER: 0, CARD: 0, ONLINE: 0 }, 'OTHER'), 0);
});

test('precio efectivo de PadFit: lista 37.500 con 20% = 30.000', () => {
  const [split] = splitAllocationsWithDiscount([{ accountItemId: 'clase', amount: 37500 }], 20);
  assert.equal(split.discountAmount, 7500);
  assert.equal(split.chargedAmount, 30000);
});

test('redondea por ítem y lo cobrado + descuento siempre suma la lista', () => {
  const splits = splitAllocationsWithDiscount(
    [{ accountItemId: 'a', amount: 1000.01 }, { accountItemId: 'b', amount: 333.33 }],
    15
  );
  for (const split of splits) {
    assert.equal(Number((split.chargedAmount + split.discountAmount).toFixed(2)), split.listAmount);
  }
  assert.equal(splits[1].discountAmount, 50);
});

test('applyToItemsTx baja ítems y cuenta, registra descuento y ajuste contable', async () => {
  const calls: Record<string, any[]> = { itemUpdate: [], discountUpsert: [], accountUpdate: [], adjustment: [], policyCreate: [] };
  const tx: any = {
    discountPolicy: {
      findFirst: async () => null,
      create: async (args: any) => { calls.policyCreate.push(args.data); return { id: 'policy-cash' }; },
      update: async () => ({})
    },
    accountItem: { update: async (args: any) => { calls.itemUpdate.push(args); return {}; } },
    accountItemDiscount: { upsert: async (args: any) => { calls.discountUpsert.push(args); return {}; } },
    account: { update: async (args: any) => { calls.accountUpdate.push(args); return {}; } }
  };

  const service = new PaymentMethodDiscountService();
  const total = await service.applyToItemsTx(tx, {
    clubId: 7,
    accountId: 'acc-1',
    method: 'CASH',
    percent: 20,
    splits: splitAllocationsWithDiscount([{ accountItemId: 'cancha', amount: 10000 }, { accountItemId: 'agua', amount: 2000 }], 20),
    items: [{ id: 'cancha', type: 'BOOKING', total: 10000 }, { id: 'agua', type: 'PRODUCT', total: 2000 }],
    postAdjustment: async (input) => { calls.adjustment.push(input); }
  });

  assert.equal(total, 2400);
  assert.equal(calls.policyCreate[0].isActive, false);
  assert.equal(calls.policyCreate[0].description, 'SYSTEM:PAYMENT_METHOD:CASH');
  assert.equal(Number(calls.itemUpdate[0].data.total), 8000);
  assert.equal(Number(calls.itemUpdate[1].data.total), 1600);
  assert.equal(Number(calls.discountUpsert[0].create.discountAmount), 2000);
  assert.deepEqual(calls.adjustment.map((a) => a.revenueAccount), ['BOOKING_REVENUE', 'BAR_REVENUE']);
  assert.equal(Number(calls.accountUpdate[0].data.totalAmount.decrement), 2400);
});

test('sin descuento no toca nada', async () => {
  const tx: any = new Proxy({}, { get: () => { throw new Error('no debería usar tx'); } });
  const total = await new PaymentMethodDiscountService().applyToItemsTx(tx, {
    clubId: 7,
    accountId: 'acc-1',
    method: 'CASH',
    percent: 20,
    splits: [],
    items: [],
    postAdjustment: async () => undefined
  });
  assert.equal(total, 0);
});

test('hints públicos: el precio efectivo se oculta si el club lo apaga; online siempre', async () => {
  const { buildPublicPriceHints, applyPercentToAmounts, readShowCashPriceInApp } = await import('../src/services/PaymentMethodDiscountService');
  assert.deepEqual(buildPublicPriceHints({ CASH: 20, ONLINE: 5 }), { cashPercent: 20, onlinePercent: 5 });
  assert.deepEqual(buildPublicPriceHints({ CASH: 20, ONLINE: 5, showCashPriceInApp: false }), { cashPercent: 0, onlinePercent: 5 });
  assert.equal(readShowCashPriceInApp(null), true);
  assert.equal(applyPercentToAmounts([37500], 20), 30000);
  assert.equal(applyPercentToAmounts([1000.01, 333.33], 15), Number((1000.01 + 333.33 - 150 - 50).toFixed(2)));
});

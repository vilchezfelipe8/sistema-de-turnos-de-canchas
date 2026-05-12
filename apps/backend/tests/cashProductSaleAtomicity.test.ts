import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { CashService } from '../src/services/CashService';
import { prisma } from '../src/prisma';

type ProductRow = {
  id: number;
  clubId: number;
  name: string;
  category: string;
  price: number;
  stock: number;
  isActive: boolean;
};

type HarnessState = {
  accounts: Array<{ id: string; clubId: number; totalAmount: number }>;
  accountItems: Array<{ id: string; accountId: string; total: number }>;
  payments: Array<{ id: string; accountId: string; amount: number }>;
  paymentAllocations: Array<{ paymentId: string; accountId: string; accountItemId: string; amount: number }>;
  products: Map<number, ProductRow>;
  nextAccountId: number;
  nextItemId: number;
  nextPaymentId: number;
  clientCreateCalls: number;
};

type PaymentBehavior = 'success' | 'fail_before_write' | 'fail_after_payment_write' | 'fail_no_shift';

function cloneState(state: HarnessState): HarnessState {
  return {
    accounts: state.accounts.map((entry) => ({ ...entry })),
    accountItems: state.accountItems.map((entry) => ({ ...entry })),
    payments: state.payments.map((entry) => ({ ...entry })),
    paymentAllocations: state.paymentAllocations.map((entry) => ({ ...entry })),
    products: new Map(Array.from(state.products.entries()).map(([id, product]) => [id, { ...product }])),
    nextAccountId: state.nextAccountId,
    nextItemId: state.nextItemId,
    nextPaymentId: state.nextPaymentId,
    clientCreateCalls: state.clientCreateCalls
  };
}

function commitState(target: HarnessState, source: HarnessState) {
  target.accounts = source.accounts;
  target.accountItems = source.accountItems;
  target.payments = source.payments;
  target.paymentAllocations = source.paymentAllocations;
  target.products = source.products;
  target.nextAccountId = source.nextAccountId;
  target.nextItemId = source.nextItemId;
  target.nextPaymentId = source.nextPaymentId;
  target.clientCreateCalls = source.clientCreateCalls;
}

function buildTx(state: HarnessState) {
  return {
    club: {
      findUnique: async () => ({ country: 'AR' })
    },
    client: {
      findFirst: async (args: any) => {
        if (args?.where?.id) return { id: String(args.where.id) };
        return null;
      },
      create: async () => {
        state.clientCreateCalls += 1;
        return { id: 'client-new' };
      }
    },
    product: {
      findFirst: async (args: any) => {
        const where = args?.where || {};
        const product = state.products.get(Number(where.id));
        if (!product) return null;
        if (Number(product.clubId) !== Number(where.clubId)) return null;
        return { ...product };
      },
      updateMany: async (args: any) => {
        const where = args?.where || {};
        const product = state.products.get(Number(where.id));
        if (!product) return { count: 0 };
        if (Number(product.clubId) !== Number(where.clubId)) return { count: 0 };
        const minStock = Number(where?.stock?.gte || 0);
        if (Number(product.stock) < minStock) return { count: 0 };

        const decrement = Number(args?.data?.stock?.decrement || 0);
        product.stock = Number(product.stock) - decrement;
        state.products.set(product.id, product);
        return { count: 1 };
      }
    },
    account: {
      create: async (args: any) => {
        const id = `acc-${state.nextAccountId++}`;
        state.accounts.push({
          id,
          clubId: Number(args?.data?.clubId),
          totalAmount: Number(args?.data?.totalAmount || 0)
        });
        return { id };
      },
      update: async (args: any) => {
        const account = state.accounts.find((entry) => entry.id === String(args?.where?.id));
        if (!account) throw new Error('Cuenta no encontrada');
        const increment = Number(args?.data?.totalAmount?.increment || 0);
        account.totalAmount = Number((account.totalAmount + increment).toFixed(2));
        return { id: account.id };
      }
    },
    accountItem: {
      create: async (args: any) => {
        const id = `item-${state.nextItemId++}`;
        state.accountItems.push({
          id,
          accountId: String(args?.data?.accountId),
          total: Number(args?.data?.total || 0)
        });
        return { id };
      }
    },
    payment: {
      create: async (args: any) => {
        const id = `pay-${state.nextPaymentId++}`;
        state.payments.push({
          id,
          accountId: String(args?.data?.accountId),
          amount: Number(args?.data?.amount || 0)
        });
        return { id, accountId: String(args?.data?.accountId), amount: Number(args?.data?.amount || 0), createdAt: new Date('2026-01-02T10:00:00.000Z') };
      }
    },
    paymentAllocation: {
      createMany: async (args: any) => {
        const rows = Array.isArray(args?.data) ? args.data : [];
        for (const row of rows) {
          state.paymentAllocations.push({
            paymentId: String(row.paymentId),
            accountId: String(row.accountId),
            accountItemId: String(row.accountItemId),
            amount: Number(row.amount || 0)
          });
        }
        return { count: rows.length };
      }
    }
  };
}

function withTransactionalState(state: HarnessState, run: () => Promise<void>) {
  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) => {
    const working = cloneState(state);
    const tx = buildTx(working);
    try {
      const result = await fn(tx);
      commitState(state, working);
      return result;
    } catch (error) {
      throw error;
    }
  };

  return run().finally(() => {
    (prisma as any).$transaction = originalTransaction;
  });
}

function buildHarness(options?: { products?: ProductRow[]; paymentBehavior?: PaymentBehavior }) {
  const service = new CashService({} as any) as any;
  const products = options?.products || [{
    id: 101,
    clubId: 5,
    name: 'Pelota',
    category: 'INSUMO',
    price: 1000,
    stock: 20,
    isActive: true
  }];
  const paymentBehavior = options?.paymentBehavior || 'success';

  const state: HarnessState = {
    accounts: [],
    accountItems: [],
    payments: [],
    paymentAllocations: [],
    products: new Map(products.map((product) => [product.id, { ...product }])),
    nextAccountId: 1,
    nextItemId: 1,
    nextPaymentId: 1,
    clientCreateCalls: 0
  };

  service.discountService = {
    computeDraftDiscountTx: async (_tx: any, draft: any) => ({
      unitPrice: Number(draft.unitPrice || 0),
      total: Number((Number(draft.unitPrice || 0) * Number(draft.quantity || 0)).toFixed(2)),
      snapshots: []
    }),
    persistAppliedDiscountsTx: async () => null
  };

  service.accountingService = {
    createAccountItemTransaction: async () => null
  };

  service.projectionService = {
    refreshAccountSummary: async () => null
  };

  service.paymentService = {
    createInTransaction: async (tx: any, input: any) => {
      if (paymentBehavior === 'fail_no_shift') {
        throw new Error('No hay turno de caja abierto para pagos POS');
      }
      if (paymentBehavior === 'fail_before_write') {
        throw new Error('PAYMENT_FAILED');
      }

      const created = await tx.payment.create({
        data: {
          accountId: input.accountId,
          amount: new Prisma.Decimal(Number(input.amount || 0))
        }
      });

      if (paymentBehavior === 'fail_after_payment_write') {
        throw new Error('ALLOCATION_FAILED');
      }

      const allocations = Array.isArray(input.allocations) ? input.allocations : [];
      if (allocations.length > 0) {
        await tx.paymentAllocation.createMany({
          data: allocations.map((allocation: any) => ({
            paymentId: created.id,
            accountId: input.accountId,
            accountItemId: String(allocation.accountItemId),
            amount: new Prisma.Decimal(Number(allocation.amount || 0))
          }))
        });
      }

      return {
        id: created.id,
        accountId: input.accountId,
        amount: Number(input.amount || 0),
        allocations
      };
    }
  };

  return { service: service as CashService, state };
}

test('venta POS exitosa persiste cuenta, items, stock, payment y allocations', async () => {
  const { service, state } = buildHarness({
    products: [
      { id: 101, clubId: 5, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 20, isActive: true },
      { id: 202, clubId: 5, name: 'Agua', category: 'BAR', price: 500, stock: 10, isActive: true }
    ]
  });

  await withTransactionalState(state, async () => {
    const sale = await service.createProductSale({
      clubId: 5,
      items: [
        { productId: 101, quantity: 2 },
        { productId: 202, quantity: 1 }
      ],
      method: 'CASH',
      clientId: 'client-1'
    } as any);

    assert.equal(sale.accountId, 'acc-1');
    assert.equal(Array.isArray(sale.payments), true);
    assert.equal(sale.payments.length, 1);
  });

  assert.equal(state.accounts.length, 1);
  assert.equal(state.accountItems.length, 2);
  assert.equal(state.payments.length, 1);
  assert.equal(state.paymentAllocations.length, 2);
  assert.equal(state.products.get(101)?.stock, 18);
  assert.equal(state.products.get(202)?.stock, 9);
});

test('si falla el pago antes de escribir, la venta completa rollbackea', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 5, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 20, isActive: true }],
    paymentBehavior: 'fail_before_write'
  });

  await withTransactionalState(state, async () => {
    await assert.rejects(
      () => service.createProductSale({
        clubId: 5,
        items: [{ productId: 101, quantity: 1 }],
        method: 'CASH',
        clientId: 'client-1'
      } as any),
      /PAYMENT_FAILED/
    );
  });

  assert.equal(state.accounts.length, 0);
  assert.equal(state.accountItems.length, 0);
  assert.equal(state.payments.length, 0);
  assert.equal(state.paymentAllocations.length, 0);
  assert.equal(state.products.get(101)?.stock, 20);
});

test('si falla luego de crear payment, no queda payment ni stock descontado', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 5, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 20, isActive: true }],
    paymentBehavior: 'fail_after_payment_write'
  });

  await withTransactionalState(state, async () => {
    await assert.rejects(
      () => service.createProductSale({
        clubId: 5,
        items: [{ productId: 101, quantity: 1 }],
        method: 'CASH',
        clientId: 'client-1'
      } as any),
      /ALLOCATION_FAILED/
    );
  });

  assert.equal(state.accounts.length, 0);
  assert.equal(state.accountItems.length, 0);
  assert.equal(state.payments.length, 0);
  assert.equal(state.paymentAllocations.length, 0);
  assert.equal(state.products.get(101)?.stock, 20);
});

test('producto inactivo falla sin escribir cuenta, items ni pagos', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 5, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 20, isActive: false }]
  });

  await withTransactionalState(state, async () => {
    await assert.rejects(
      () => service.createProductSale({
        clubId: 5,
        items: [{ productId: 101, quantity: 1 }],
        method: 'CASH',
        clientId: 'client-1'
      } as any),
      /Producto inactivo/
    );
  });

  assert.equal(state.accounts.length, 0);
  assert.equal(state.accountItems.length, 0);
  assert.equal(state.payments.length, 0);
  assert.equal(state.products.get(101)?.stock, 20);
});

test('producto de otro club falla sin escritura parcial', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 99, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 20, isActive: true }]
  });

  await withTransactionalState(state, async () => {
    await assert.rejects(
      () => service.createProductSale({
        clubId: 5,
        items: [{ productId: 101, quantity: 1 }],
        method: 'CASH',
        clientId: 'client-1'
      } as any),
      /Producto no encontrado/
    );
  });

  assert.equal(state.accounts.length, 0);
  assert.equal(state.accountItems.length, 0);
  assert.equal(state.payments.length, 0);
  assert.equal(state.products.get(101)?.stock, 20);
});

test('stock insuficiente falla sin crear cuenta ni pagos', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 5, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 1, isActive: true }]
  });

  await withTransactionalState(state, async () => {
    await assert.rejects(
      () => service.createProductSale({
        clubId: 5,
        items: [{ productId: 101, quantity: 2 }],
        method: 'CASH',
        clientId: 'client-1'
      } as any),
      /Stock insuficiente/
    );
  });

  assert.equal(state.accounts.length, 0);
  assert.equal(state.accountItems.length, 0);
  assert.equal(state.payments.length, 0);
  assert.equal(state.products.get(101)?.stock, 1);
});

// ─── Fase 1.6: Consumidor final ──────────────────────────────────────────────

test('consumidor final - venta sin cliente crea cuenta BAR, items, payment y descuenta stock', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 5, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 20, isActive: true }]
  });

  let sale: any;
  await withTransactionalState(state, async () => {
    // Sin clientId ni clientDraft → Consumidor final
    sale = await service.createProductSale({
      clubId: 5,
      items: [{ productId: 101, quantity: 3 }],
      method: 'CASH'
    } as any);
  });

  assert.equal(state.accounts.length, 1, 'debe crear exactamente 1 cuenta');
  assert.equal(state.accountItems.length, 1, 'debe crear exactamente 1 item');
  assert.equal(state.payments.length, 1, 'debe crear exactamente 1 pago');
  assert.equal(state.paymentAllocations.length, 1, 'debe crear exactamente 1 allocation');
  assert.equal(state.products.get(101)?.stock, 17, 'debe descontar 3 unidades del stock');
  assert.ok(sale?.description?.includes('Consumidor final'), `descripcion debe incluir "Consumidor final", recibida: "${sale?.description}"`);
});

test('consumidor final - venta sin cliente no invoca client.create', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 5, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 10, isActive: true }]
  });

  await withTransactionalState(state, async () => {
    await service.createProductSale({
      clubId: 5,
      items: [{ productId: 101, quantity: 1 }],
      method: 'CASH'
    } as any);
  });

  assert.equal(state.clientCreateCalls, 0, 'no debe intentar crear ningún Client en la base de datos');
});

test('consumidor final con clientDraft - descripcion incluye nombre del cliente', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 5, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 10, isActive: true }]
  });

  let sale: any;
  await withTransactionalState(state, async () => {
    sale = await service.createProductSale({
      clubId: 5,
      items: [{ productId: 101, quantity: 1 }],
      method: 'CASH',
      clientDraft: { name: 'Juan Pérez', phone: '11 1234-5678', phoneNumberLocal: '11 1234-5678' }
    } as any);
  });

  assert.equal(state.accounts.length, 1);
  assert.ok(
    sale?.description?.includes('Juan Pérez'),
    `descripcion debe incluir el nombre del clientDraft, recibida: "${sale?.description}"`
  );
  assert.ok(
    !sale?.description?.includes('Consumidor final'),
    'descripcion NO debe decir "Consumidor final" cuando hay clientDraft'
  );
});

test('sin turno de caja abierto - falla sin dejar escritura parcial', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 5, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 20, isActive: true }],
    paymentBehavior: 'fail_no_shift'
  });

  await withTransactionalState(state, async () => {
    await assert.rejects(
      () => service.createProductSale({
        clubId: 5,
        items: [{ productId: 101, quantity: 1 }],
        method: 'CASH'
      } as any),
      /No hay turno de caja abierto para pagos POS/
    );
  });

  assert.equal(state.accounts.length, 0, 'no debe quedar ninguna cuenta creada');
  assert.equal(state.accountItems.length, 0, 'no debe quedar ningún item creado');
  assert.equal(state.payments.length, 0, 'no debe quedar ningún pago creado');
  assert.equal(state.products.get(101)?.stock, 20, 'el stock no debe haber cambiado');
});

test('venta con clientId explícito sigue funcionando tras Fase 1.6', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 5, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 5, isActive: true }]
  });

  let sale: any;
  await withTransactionalState(state, async () => {
    sale = await service.createProductSale({
      clubId: 5,
      items: [{ productId: 101, quantity: 2 }],
      method: 'CASH',
      clientId: 'client-1'
    } as any);
  });

  assert.equal(state.accounts.length, 1, 'debe crear la cuenta');
  assert.equal(state.payments.length, 1, 'debe crear el pago');
  assert.equal(state.products.get(101)?.stock, 3, 'debe descontar stock');
  assert.ok(
    !sale?.description?.includes('Consumidor final'),
    'con clientId explícito la descripcion no debe decir Consumidor final'
  );
});

// ─── Fase 1.6B: createProductSaleAccount (sin pago) ──────────────────────────

// Helper: mockea los calls FUERA de $transaction (cashShift, idempotencia)
// y mantiene el mock de $transaction para el bloque interno.
function withAccountSaleState(
  state: HarnessState,
  options: { hasOpenShift?: boolean },
  run: () => Promise<void>
) {
  const hasOpenShift = options.hasOpenShift !== false;

  const originalTransaction = (prisma as any).$transaction;
  const originalCashShift = (prisma as any).cashShift;
  const originalAccount = (prisma as any).account;

  (prisma as any).cashShift = {
    findFirst: async () => hasOpenShift ? { id: 'shift-1', status: 'OPEN' } : null
  };

  // account.findFirst solo se usa fuera de tx para idempotencia — siempre null (sin key preexistente)
  (prisma as any).account = {
    ...originalAccount,
    findFirst: async () => null
  };

  (prisma as any).$transaction = async (fn: any) => {
    const working = cloneState(state);
    const tx = buildTx(working);
    try {
      const result = await fn(tx);
      commitState(state, working);
      return result;
    } catch (error) {
      throw error;
    }
  };

  return run().finally(() => {
    (prisma as any).$transaction = originalTransaction;
    (prisma as any).cashShift = originalCashShift;
    (prisma as any).account = originalAccount;
  });
}

test('[1.6B] createProductSaleAccount - consumidor final crea cuenta + items + stock sin pago', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 5, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 20, isActive: true }]
  });

  let result: any;
  await withAccountSaleState(state, { hasOpenShift: true }, async () => {
    result = await service.createProductSaleAccount({
      clubId: 5,
      items: [{ productId: 101, quantity: 3 }]
    } as any);
  });

  assert.equal(state.accounts.length, 1, 'debe crear exactamente 1 cuenta');
  assert.equal(state.accountItems.length, 1, 'debe crear exactamente 1 item');
  assert.equal(state.payments.length, 0, 'NO debe crear ningún pago');
  assert.equal(state.paymentAllocations.length, 0, 'NO debe crear ninguna allocation');
  assert.equal(state.products.get(101)?.stock, 17, 'debe descontar 3 unidades del stock');
  assert.ok(result?.accountId, 'debe devolver accountId');
  assert.ok(result?.description?.includes('Consumidor final'), `descripcion debe incluir "Consumidor final", recibida: "${result?.description}"`);
  assert.ok(result?.total > 0, 'debe devolver el total calculado');
});

test('[1.6B] createProductSaleAccount - consumidor final no crea Client ni User', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 5, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 10, isActive: true }]
  });

  await withAccountSaleState(state, { hasOpenShift: true }, async () => {
    await service.createProductSaleAccount({
      clubId: 5,
      items: [{ productId: 101, quantity: 1 }]
    } as any);
  });

  assert.equal(state.clientCreateCalls, 0, 'no debe invocar client.create');
});

test('[1.6B] createProductSaleAccount - sin caja abierta falla sin escritura', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 5, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 20, isActive: true }]
  });

  await withAccountSaleState(state, { hasOpenShift: false }, async () => {
    await assert.rejects(
      () => service.createProductSaleAccount({
        clubId: 5,
        items: [{ productId: 101, quantity: 1 }]
      } as any),
      /Abrí una caja antes de registrar ventas de mostrador/
    );
  });

  assert.equal(state.accounts.length, 0, 'no debe crear ninguna cuenta');
  assert.equal(state.accountItems.length, 0, 'no debe crear ningún item');
  assert.equal(state.payments.length, 0, 'no debe crear ningún pago');
  assert.equal(state.products.get(101)?.stock, 20, 'stock sin cambios');
});

test('[1.6B] createProductSaleAccount - stock insuficiente rollbackea cuenta', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 5, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 1, isActive: true }]
  });

  await withAccountSaleState(state, { hasOpenShift: true }, async () => {
    await assert.rejects(
      () => service.createProductSaleAccount({
        clubId: 5,
        items: [{ productId: 101, quantity: 5 }]
      } as any),
      /Stock insuficiente/
    );
  });

  assert.equal(state.accounts.length, 0, 'no debe quedar cuenta creada');
  assert.equal(state.accountItems.length, 0, 'no debe quedar item creado');
  assert.equal(state.payments.length, 0, 'no debe haber pago');
  assert.equal(state.products.get(101)?.stock, 1, 'stock sin cambios');
});

test('[1.6B] createProductSaleAccount - producto de otro club falla sin escritura', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 99, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 20, isActive: true }]
  });

  await withAccountSaleState(state, { hasOpenShift: true }, async () => {
    await assert.rejects(
      () => service.createProductSaleAccount({
        clubId: 5,
        items: [{ productId: 101, quantity: 1 }]
      } as any),
      /Producto no encontrado/
    );
  });

  assert.equal(state.accounts.length, 0, 'no debe crear cuenta');
  assert.equal(state.payments.length, 0, 'no debe crear pago');
});

test('[1.6B] createProductSaleAccount - producto inactivo falla sin escritura', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 5, name: 'Pelota', category: 'INSUMO', price: 1000, stock: 20, isActive: false }]
  });

  await withAccountSaleState(state, { hasOpenShift: true }, async () => {
    await assert.rejects(
      () => service.createProductSaleAccount({
        clubId: 5,
        items: [{ productId: 101, quantity: 1 }]
      } as any),
      /Producto inactivo/
    );
  });

  assert.equal(state.accounts.length, 0, 'no debe crear cuenta');
  assert.equal(state.products.get(101)?.stock, 20, 'stock sin cambios');
});

test('[1.6B] createProductSaleAccount - con clientId válido crea cuenta sin pago', async () => {
  const { service, state } = buildHarness({
    products: [{ id: 101, clubId: 5, name: 'Agua', category: 'BAR', price: 500, stock: 10, isActive: true }]
  });

  let result: any;
  await withAccountSaleState(state, { hasOpenShift: true }, async () => {
    result = await service.createProductSaleAccount({
      clubId: 5,
      items: [{ productId: 101, quantity: 2 }],
      clientId: 'client-abc'
    } as any);
  });

  assert.equal(state.accounts.length, 1, 'debe crear la cuenta');
  assert.equal(state.payments.length, 0, 'NO debe crear pago');
  assert.equal(state.products.get(101)?.stock, 8, 'debe descontar stock');
  assert.ok(result?.accountId, 'debe devolver accountId');
});

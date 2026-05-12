import test from 'node:test';
import assert from 'node:assert/strict';
import { CashService } from '../src/services/CashService';
import { prisma } from '../src/prisma';

function buildServiceHarness() {
  const service = new CashService({} as any) as any;

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
    createInTransaction: async (_tx: any, input: any) => ({
      id: 'pay-1',
      amount: Number(input.amount || 0),
      method: input.method
    }),
    create: async (input: any) => ({
      id: 'pay-1',
      amount: Number(input.amount || 0),
      method: input.method
    })
  };

  return service as CashService;
}

function withMockedTransaction(tx: any, run: () => Promise<void>) {
  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) => fn(tx);
  return run().finally(() => {
    (prisma as any).$transaction = originalTransaction;
  });
}

function buildQuoteTx(overrides?: Partial<any>) {
  const bySignal: Record<string, any> = overrides?.bySignal || {};
  return {
    club: {
      findUnique: async () => ({ country: 'AR' })
    },
    client: {
      findFirst: async (args: any) => {
        if (args?.where?.id) return bySignal.byId || null;
        if (args?.where?.dni) return bySignal.byDni || null;
        if (args?.where?.phone) return bySignal.byPhone || null;
        if (args?.where?.email) return bySignal.byEmail || null;
        return null;
      },
      create: async (args: any) => ({ id: 'client-new', ...args.data })
    },
    product: {
      findFirst: async () => ({
        id: 101,
        name: 'Pelota',
        price: 1000,
        category: 'INSUMO',
        stock: 20,
        isActive: true
      }),
      updateMany: async () => ({ count: 1 })
    },
    account: {
      create: async () => ({ id: 'acc-1' }),
      update: async () => ({ id: 'acc-1' })
    },
    accountItem: {
      create: async () => ({ id: 'item-1' })
    },
    ...overrides
  };
}

test('cotización con clientId usa cliente existente', async () => {
  const service = buildServiceHarness();
  const tx = buildQuoteTx({
    bySignal: {
      byId: { id: 'client-1' }
    }
  });

  await withMockedTransaction(tx, async () => {
    const quote = await service.quoteProductSale({
      clubId: 5,
      items: [{ productId: 101, quantity: 1 }],
      clientId: 'client-1'
    } as any);

    assert.equal(quote.clientId, 'client-1');
    assert.equal(Array.isArray(quote.items), true);
    assert.equal(quote.items.length, 1);
  });
});

test('cotización con clientDraft resuelve por teléfono/email/dni, sin match por nombre', async () => {
  const service = buildServiceHarness();
  const tx = buildQuoteTx({
    bySignal: {
      byDni: null,
      byPhone: null,
      byEmail: null
    }
  });

  await withMockedTransaction(tx, async () => {
    const quote = await service.quoteProductSale({
      clubId: 5,
      items: [{ productId: 101, quantity: 1 }],
      clientDraft: {
        name: 'Cliente Solo Nombre',
        phone: '3517778888'
      }
    } as any);

    assert.equal(quote.clientId, null);
  });
});

test('venta con clientId mantiene identidad client-centric', async () => {
  const service = buildServiceHarness();
  const tx = buildQuoteTx({
    bySignal: {
      byId: { id: 'client-1' }
    },
    product: {
      findFirst: async () => ({
        id: 101,
        name: 'Pelota',
        price: 1000,
        category: 'INSUMO',
        stock: 20,
        isActive: true
      }),
      updateMany: async () => ({ count: 1 })
    }
  });

  await withMockedTransaction(tx, async () => {
    const sale = await service.createProductSale({
      clubId: 5,
      items: [{ productId: 101, quantity: 1 }],
      method: 'CASH',
      clientId: 'client-1'
    } as any);

    assert.equal(sale.accountId, 'acc-1');
    assert.equal(Array.isArray(sale.payments), true);
    assert.equal(sale.payments.length, 1);
  });
});

test('venta con clientDraft crea cliente cuando no existe match seguro', async () => {
  const service = buildServiceHarness();
  let createdClientPayload: any = null;

  const tx = buildQuoteTx({
    bySignal: {
      byDni: null,
      byPhone: null,
      byEmail: null
    },
    client: {
      findFirst: async (args: any) => {
        if (args?.where?.dni) return null;
        if (args?.where?.phone) return null;
        if (args?.where?.email) return null;
        return null;
      },
      create: async (args: any) => {
        createdClientPayload = args.data;
        return { id: 'client-new', ...args.data };
      }
    },
    product: {
      findFirst: async () => ({
        id: 101,
        name: 'Pelota',
        price: 1000,
        category: 'INSUMO',
        stock: 20,
        isActive: true
      }),
      updateMany: async () => ({ count: 1 })
    }
  });

  await withMockedTransaction(tx, async () => {
    const sale = await service.createProductSale({
      clubId: 5,
      items: [{ productId: 101, quantity: 1 }],
      method: 'CASH',
      clientDraft: {
        name: 'Cliente Nuevo',
        phone: '3511234567',
        dni: '32123456',
        email: 'nuevo@example.com'
      }
    } as any);

    assert.equal(sale.accountId, 'acc-1');
    assert.equal(createdClientPayload.name, 'Cliente Nuevo');
    assert.equal(createdClientPayload.phone, '+5493511234567');
  });
});

test('cash matchea por teléfono canónico aunque llegue en formato local', async () => {
  const service = buildServiceHarness();
  let seenPhoneWhere: string | null = null;
  const tx = buildQuoteTx({
    client: {
      findFirst: async (args: any) => {
        if (args?.where?.id) return null;
        if (Array.isArray(args?.where?.phone?.in)) {
          seenPhoneWhere = String(args.where.phone.in[0] || '');
          return { id: 'client-canonical' };
        }
        return null;
      },
      create: async (args: any) => ({ id: 'client-new', ...args.data })
    }
  });

  await withMockedTransaction(tx, async () => {
    const quote = await service.quoteProductSale({
      clubId: 5,
      items: [{ productId: 101, quantity: 1 }],
      clientDraft: {
        name: 'Cliente Local',
        phone: '351 123-4567'
      }
    } as any);

    assert.equal(quote.clientId, 'client-canonical');
    assert.equal(seenPhoneWhere, '+5493511234567');
  });
});

test('no permite resolver cliente por nombre solo', async () => {
  const service = buildServiceHarness();

  await withMockedTransaction(buildQuoteTx(), async () => {
    await assert.rejects(
      () => service.quoteProductSale({
        clubId: 5,
        items: [{ productId: 101, quantity: 1 }],
        clientDraft: {
          name: 'Nombre Solamente',
          phone: ''
        }
      } as any),
      /CLIENT_DRAFT_INVALID/
    );
  });
});

test('duplicado posible devuelve error prudente', async () => {
  const service = buildServiceHarness();
  const tx = buildQuoteTx({
    bySignal: {
      byPhone: { id: 'client-1' },
      byEmail: { id: 'client-2' }
    }
  });

  await withMockedTransaction(tx, async () => {
    await assert.rejects(
      () => service.quoteProductSale({
        clubId: 5,
        items: [{ productId: 101, quantity: 1 }],
        clientDraft: {
          name: 'Cliente Duplicado',
          phone: '3519998888',
          email: 'dup@example.com'
        }
      } as any),
      /CLIENT_POSSIBLE_DUPLICATE/
    );
  });
});

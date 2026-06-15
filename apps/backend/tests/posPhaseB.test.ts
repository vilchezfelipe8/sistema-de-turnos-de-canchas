import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { AccountService } from '../src/services/AccountService';
import { CashService } from '../src/services/CashService';
import { AppError, ErrorCodes } from '../src/errors';
import { prisma } from '../src/prisma';

type VoidHarnessState = {
  account: {
    id: string;
    clubId: number;
    sourceType: string;
    sourceId: string;
    status: 'OPEN' | 'CLOSED';
    totalAmount: number;
    items: Array<{ id: string; type: 'PRODUCT' | 'SERVICE'; productId: number | null; quantity: number; total: number; description: string }>;
    payments: Array<{ id: string; amount: number; status: string }>;
    refunds: Array<{ id: string; amount: number; status: string }>;
    ledgerEntries: Array<{ accountItemId: string; account: string }>;
  };
  productStocks: Map<number, number>;
  auditLogs: Array<Record<string, unknown>>;
};

function cloneVoidState(state: VoidHarnessState): VoidHarnessState {
  return {
    account: {
      ...state.account,
      items: state.account.items.map((item) => ({ ...item })),
      payments: state.account.payments.map((payment) => ({ ...payment })),
      refunds: state.account.refunds.map((refund) => ({ ...refund })),
      ledgerEntries: state.account.ledgerEntries.map((entry) => ({ ...entry }))
    },
    productStocks: new Map(state.productStocks),
    auditLogs: state.auditLogs.map((entry) => ({ ...entry }))
  };
}

function commitVoidState(target: VoidHarnessState, source: VoidHarnessState) {
  target.account = source.account;
  target.productStocks = source.productStocks;
  target.auditLogs = source.auditLogs;
}

async function withVoidTransaction(state: VoidHarnessState, run: (service: AccountService, reverseCalls: Array<any>) => Promise<void>) {
  const originalTransaction = (prisma as any).$transaction;
  const service = new AccountService() as any;
  const reverseCalls: Array<any> = [];
  service.projectionService = { refreshAccountSummary: async () => null };
  service.accountingService = {
    reverseAccountItemTransaction: async (_tx: any, input: any) => {
      reverseCalls.push(input);
      return null;
    }
  };

  (prisma as any).$transaction = async (fn: any) => {
    const working = cloneVoidState(state);
    const tx = {
      account: {
        findFirst: async (args: any) => {
          if (String(args?.where?.id) !== working.account.id) return null;
          if (Number(args?.where?.clubId) !== working.account.clubId) return null;
          return {
            ...working.account,
            totalAmount: new Prisma.Decimal(working.account.totalAmount),
            items: working.account.items.map((item) => ({ ...item, total: new Prisma.Decimal(item.total) }))
          };
        },
        update: async (args: any) => {
          if (String(args?.where?.id) !== working.account.id) throw new Error('Cuenta no encontrada');
          working.account = {
            ...working.account,
            status: String(args?.data?.status || working.account.status) as 'OPEN' | 'CLOSED',
            closedAt: args?.data?.closedAt || null,
            sourceId: String(args?.data?.sourceId || working.account.sourceId)
          } as any;
          return { id: working.account.id, status: working.account.status, sourceId: working.account.sourceId };
        }
      },
      product: {
        updateMany: async (args: any) => {
          const productId = Number(args?.where?.id || 0);
          const currentStock = Number(working.productStocks.get(productId) || 0);
          if (!working.productStocks.has(productId)) return { count: 0 };
          const increment = Number(args?.data?.stock?.increment || 0);
          working.productStocks.set(productId, currentStock + increment);
          return { count: 1 };
        }
      },
      auditLog: {
        create: async (args: any) => {
          working.auditLogs.push(args?.data || {});
          return args?.data;
        }
      }
    };

    const result = await fn(tx);
    commitVoidState(state, working);
    return result;
  };

  try {
    await run(service as AccountService, reverseCalls);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
}

function buildVoidState(overrides?: Partial<VoidHarnessState['account']>): VoidHarnessState {
  return {
    account: {
      id: 'acc-pos-1',
      clubId: 7,
      sourceType: 'BAR',
      sourceId: 'pos-account-1',
      status: 'OPEN',
      totalAmount: 2400,
      items: [
        { id: 'item-prod', type: 'PRODUCT', productId: 101, quantity: 2, total: 2400, description: 'Pelota' }
      ],
      payments: [],
      refunds: [],
      ledgerEntries: [{ accountItemId: 'item-prod', account: 'BAR_REVENUE' }],
      ...overrides
    },
    productStocks: new Map([[101, 8]]),
    auditLogs: []
  };
}

test('anular venta POS sin pagos revierte stock y deja auditoría', async () => {
  const state = buildVoidState();

  await withVoidTransaction(state, async (service, reverseCalls) => {
    const result = await service.voidPosAccount(7, 'acc-pos-1', 99);
    assert.equal((result as any).status, 'CLOSED');
    assert.equal(state.account.status, 'CLOSED');
    assert.match(state.account.sourceId, /^VOID-/);
    assert.equal(state.productStocks.get(101), 10);
    assert.equal(reverseCalls.length, 1);
    assert.equal(state.auditLogs.length, 1);
    assert.equal(state.auditLogs[0].action, 'VOID_POS_ACCOUNT');
  });
});

test('anular venta POS con pagos bloquea', async () => {
  const state = buildVoidState({
    payments: [{ id: 'pay-1', amount: 1200, status: 'COMPLETED' }]
  });

  await withVoidTransaction(state, async (service) => {
    await assert.rejects(
      () => service.voidPosAccount(7, 'acc-pos-1', 99),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.ACCOUNT_HAS_PAYMENTS
    );
    assert.equal(state.account.status, 'OPEN');
    assert.equal(state.productStocks.get(101), 8);
  });
});

test('anular venta POS con devoluciones bloquea', async () => {
  const state = buildVoidState({
    refunds: [{ id: 'refund-1', amount: 1200, status: 'REQUESTED' }]
  });

  await withVoidTransaction(state, async (service) => {
    await assert.rejects(
      () => service.voidPosAccount(7, 'acc-pos-1', 99),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.ACCOUNT_HAS_REFUNDS
    );
    assert.equal(state.account.status, 'OPEN');
  });
});

test('anular venta POS ya cerrada bloquea', async () => {
  const state = buildVoidState({ status: 'CLOSED' });

  await withVoidTransaction(state, async (service) => {
    await assert.rejects(
      () => service.voidPosAccount(7, 'acc-pos-1', 99),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.ACCOUNT_CLOSED
    );
  });
});

test('anular venta no BAR/POS bloquea', async () => {
  const state = buildVoidState({ sourceType: 'MANUAL' });

  await withVoidTransaction(state, async (service) => {
    await assert.rejects(
      () => service.voidPosAccount(7, 'acc-pos-1', 99),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.INVALID_INPUT
    );
  });
});

test('anulación con error al revertir stock hace rollback completo', async () => {
  const state = buildVoidState({
    items: [
      { id: 'item-ok', type: 'PRODUCT', productId: 101, quantity: 1, total: 1200, description: 'Pelota' },
      { id: 'item-missing', type: 'PRODUCT', productId: 999, quantity: 1, total: 1200, description: 'Bidón' }
    ],
    ledgerEntries: [
      { accountItemId: 'item-ok', account: 'BAR_REVENUE' },
      { accountItemId: 'item-missing', account: 'BAR_REVENUE' }
    ]
  });

  await withVoidTransaction(state, async (service) => {
    await assert.rejects(
      () => service.voidPosAccount(7, 'acc-pos-1', 99),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.PRODUCT_NOT_FOUND
    );
    assert.equal(state.account.status, 'OPEN');
    assert.equal(state.productStocks.get(101), 8);
    assert.equal(state.auditLogs.length, 0);
  });
});

type PosCreateState = {
  accountItems: Array<Record<string, unknown>>;
  stockUpdates: number;
};

async function withPosCreateTransaction(run: (service: CashService, state: PosCreateState) => Promise<void>) {
  const service = new CashService({} as any) as any;
  const state: PosCreateState = { accountItems: [], stockUpdates: 0 };
  service.projectionService = { refreshAccountSummary: async () => null };
  service.accountingService = {
    createAccountItemTransaction: async () => null,
    mapRevenueAccount: (type: string) => (type === 'PRODUCT' ? 'BAR_REVENUE' : 'ADJUSTMENTS')
  };
  service.discountService = {
    computeDraftDiscountTx: async (_tx: any, input: any) => ({
      unitPrice: Number(input.unitPrice || 0),
      total: Number((Number(input.unitPrice || 0) * Number(input.quantity || 0)).toFixed(2)),
      snapshots: []
    }),
    persistAppliedDiscountsTx: async () => null
  };

  const originalShiftFindFirst = (prisma.cashShift as any).findFirst;
  const originalAccountFindFirst = (prisma.account as any).findFirst;
  const originalTransaction = (prisma as any).$transaction;
  (prisma.cashShift as any).findFirst = async () => ({ id: 'shift-1', status: 'OPEN' });
  (prisma.account as any).findFirst = async () => null;
  (prisma as any).$transaction = async (fn: any) => {
    const tx = {
      client: {
        findFirst: async () => null
      },
      account: {
        create: async () => ({ id: 'acc-pos', clubId: 7 }),
        update: async () => ({ id: 'acc-pos' })
      },
      accountItem: {
        create: async (args: any) => {
          state.accountItems.push(args.data);
          return { id: `item-${state.accountItems.length}` };
        }
      },
      product: {
        findFirst: async (args: any) => {
          if (Number(args?.where?.id) === 101) {
            return { id: 101, stock: 10, category: 'BAR', isActive: true };
          }
          return null;
        },
        updateMany: async () => {
          state.stockUpdates += 1;
          return { count: 1 };
        }
      },
      clubServiceCatalog: {
        findFirst: async (args: any) => {
          if (Number(args?.where?.id) === 201) {
            return { id: 201, code: 'CLASE', isActive: true };
          }
          return null;
        }
      }
    };
    return fn(tx);
  };

  try {
    await run(service as CashService, state);
  } finally {
    (prisma.cashShift as any).findFirst = originalShiftFindFirst;
    (prisma.account as any).findFirst = originalAccountFindFirst;
    (prisma as any).$transaction = originalTransaction;
  }
}

test('venta con solo servicio crea cuenta e ítem SERVICE sin tocar stock', async () => {
  await withPosCreateTransaction(async (service, state) => {
    service.quoteProductSale = (async () => ({
      finalTotal: 5000,
      listTotal: 5000,
      discountTotal: 0,
      hasDiscount: false,
      clientId: null,
      items: [{
        itemKey: 'service:201:0',
        itemType: 'SERVICE',
        productId: null,
        serviceId: 201,
        serviceCode: 'CLASE',
        productName: 'Clase suelta',
        quantity: 1,
        listUnitPrice: 5000,
        finalUnitPrice: 5000,
        finalTotal: 5000,
        listTotal: 5000,
        discountAmount: 0,
        hasDiscount: false,
        isCustom: false,
        appliedPolicies: []
      }]
    })) as any;

    const result = await service.createProductSaleAccount({
      clubId: 7,
      items: [{ serviceId: 201, quantity: 1 }]
    });

    assert.equal(result.accountId, 'acc-pos');
    assert.equal(state.accountItems.length, 1);
    assert.equal(state.accountItems[0].type, 'SERVICE');
    assert.equal(state.stockUpdates, 0);
  });
});

test('venta mixta producto + servicio descuenta stock solo del producto', async () => {
  await withPosCreateTransaction(async (service, state) => {
    service.quoteProductSale = (async () => ({
      finalTotal: 6200,
      listTotal: 6200,
      discountTotal: 0,
      hasDiscount: false,
      clientId: null,
      items: [
        {
          itemKey: 'product:101:0',
          itemType: 'PRODUCT',
          productId: 101,
          serviceId: null,
          serviceCode: null,
          productName: 'Pelota',
          quantity: 1,
          listUnitPrice: 1200,
          finalUnitPrice: 1200,
          finalTotal: 1200,
          listTotal: 1200,
          discountAmount: 0,
          hasDiscount: false,
          isCustom: false,
          appliedPolicies: []
        },
        {
          itemKey: 'service:201:1',
          itemType: 'SERVICE',
          productId: null,
          serviceId: 201,
          serviceCode: 'CLASE',
          productName: 'Clase suelta',
          quantity: 1,
          listUnitPrice: 5000,
          finalUnitPrice: 5000,
          finalTotal: 5000,
          listTotal: 5000,
          discountAmount: 0,
          hasDiscount: false,
          isCustom: false,
          appliedPolicies: []
        }
      ]
    })) as any;

    await service.createProductSaleAccount({
      clubId: 7,
      items: [{ productId: 101, quantity: 1 }, { serviceId: 201, quantity: 1 }]
    });

    assert.deepEqual(state.accountItems.map((item) => item.type), ['PRODUCT', 'SERVICE']);
    assert.equal(state.stockUpdates, 1);
  });
});

test('servicio inactivo bloquea cotización POS', async () => {
  const service = new CashService({} as any) as any;
  service.discountService = {
    computeDraftDiscountTx: async () => ({ unitPrice: 5000, total: 5000, snapshots: [] }),
    persistAppliedDiscountsTx: async () => null
  };

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) => fn({
    client: { findFirst: async () => null },
    club: { findUnique: async () => ({ country: 'AR' }) },
    clubServiceCatalog: {
      findFirst: async () => ({ id: 201, code: 'CLASE', name: 'Clase', price: 5000, isActive: false })
    }
  });

  try {
    await assert.rejects(
      () => service.quoteProductSale({ clubId: 7, items: [{ serviceId: 201, quantity: 1 }] }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.SERVICE_INACTIVE
    );
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('servicio de otro club bloquea cotización POS', async () => {
  const service = new CashService({} as any) as any;
  service.discountService = {
    computeDraftDiscountTx: async () => ({ unitPrice: 5000, total: 5000, snapshots: [] }),
    persistAppliedDiscountsTx: async () => null
  };

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) => fn({
    client: { findFirst: async () => null },
    club: { findUnique: async () => ({ country: 'AR' }) },
    clubServiceCatalog: { findFirst: async () => null }
  });

  try {
    await assert.rejects(
      () => service.quoteProductSale({ clubId: 7, items: [{ serviceId: 999, quantity: 1 }] }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.SERVICE_NOT_FOUND
    );
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('cotización POS incluye servicios con total correcto', async () => {
  const service = new CashService({} as any) as any;
  service.discountService = {
    computeDraftDiscountTx: async (_tx: any, draft: any) => ({
      unitPrice: Number(draft.unitPrice || 0),
      total: Number((Number(draft.unitPrice || 0) * Number(draft.quantity || 0)).toFixed(2)),
      snapshots: []
    }),
    persistAppliedDiscountsTx: async () => null
  };

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) => fn({
    client: { findFirst: async () => null },
    club: { findUnique: async () => ({ country: 'AR' }) },
    clubServiceCatalog: {
      findFirst: async () => ({ id: 201, code: 'CLASE', name: 'Clase suelta', price: 5000, isActive: true })
    }
  });

  try {
    const quote = await service.quoteProductSale({ clubId: 7, items: [{ serviceId: 201, quantity: 2 }] });
    assert.equal(quote.finalTotal, 10000);
    assert.equal(quote.items[0].itemType, 'SERVICE');
    assert.equal(quote.items[0].serviceId, 201);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

async function withPosReportMocks(
  setup: {
    shift?: { id: string; openedAt: Date; closedAt: Date | null } | null;
    accounts: any[];
    payments: any[];
  },
  run: (service: CashService) => Promise<void>
) {
  const service = new CashService({} as any);
  const originalClubFindUnique = (prisma.club as any).findUnique;
  const originalShiftFindFirst = (prisma.cashShift as any).findFirst;
  const originalAccountFindMany = (prisma.account as any).findMany;
  const originalPaymentFindMany = (prisma.payment as any).findMany;

  (prisma.club as any).findUnique = async () => ({
    id: 7,
    settings: { timeZone: 'America/Argentina/Cordoba' }
  });
  (prisma.cashShift as any).findFirst = async () => setup.shift || null;
  (prisma.account as any).findMany = async () => setup.accounts;
  (prisma.payment as any).findMany = async () => setup.payments;

  try {
    await run(service);
  } finally {
    (prisma.club as any).findUnique = originalClubFindUnique;
    (prisma.cashShift as any).findFirst = originalShiftFindFirst;
    (prisma.account as any).findMany = originalAccountFindMany;
    (prisma.payment as any).findMany = originalPaymentFindMany;
  }
}

test('reporte POS sin ventas devuelve totales cero', async () => {
  await withPosReportMocks({ accounts: [], payments: [] }, async (service) => {
    const report = await service.getPosReport(7, '2026-05-14', '2026-05-14');
    assert.equal(report.totals.salesTotal, 0);
    assert.equal(report.totals.paidTotal, 0);
    assert.equal(report.totals.pendingTotal, 0);
    assert.equal(report.byProduct.length, 0);
    assert.equal(report.byService.length, 0);
  });
});

test('reporte POS agrupa producto y servicio correctamente', async () => {
  await withPosReportMocks({
    accounts: [
      {
        id: 'acc-1',
        displayCode: 'CTA-1',
        sourceId: 'pos-1',
        status: 'OPEN',
        totalAmount: new Prisma.Decimal(6200),
        paidAmount: new Prisma.Decimal(1200),
        createdAt: new Date('2026-05-14T10:00:00.000Z'),
        closedAt: null,
        client: { name: 'Juan' },
        items: [
          { id: 'item-1', type: 'PRODUCT', description: 'Pelota', quantity: 1, total: new Prisma.Decimal(1200), productId: 101, product: { name: 'Pelota' } },
          { id: 'item-2', type: 'SERVICE', description: 'Clase suelta', quantity: 1, total: new Prisma.Decimal(5000), productId: null, product: null }
        ]
      }
    ],
    payments: [{ id: 'pay-1', accountId: 'acc-1', amount: new Prisma.Decimal(1200), method: 'CASH', createdAt: new Date('2026-05-14T10:05:00.000Z') }]
  }, async (service) => {
    const report = await service.getPosReport(7, '2026-05-14', '2026-05-14');
    assert.equal(report.byProduct[0].name, 'Pelota');
    assert.equal(report.byProduct[0].total, 1200);
    assert.equal(report.byService[0].name, 'Clase suelta');
    assert.equal(report.byService[0].total, 5000);
    assert.equal(report.totals.pendingTotal, 5000);
  });
});

test('reporte POS cuenta anulada suma en voidedTotal y no en pendingTotal', async () => {
  await withPosReportMocks({
    accounts: [
      {
        id: 'acc-void',
        displayCode: 'CTA-VOID',
        sourceId: 'VOID-pos-2',
        status: 'CLOSED',
        totalAmount: new Prisma.Decimal(1800),
        paidAmount: new Prisma.Decimal(0),
        createdAt: new Date('2026-05-14T11:00:00.000Z'),
        closedAt: new Date('2026-05-14T11:05:00.000Z'),
        client: null,
        items: [
          { id: 'item-void', type: 'PRODUCT', description: 'Agua', quantity: 2, total: new Prisma.Decimal(1800), productId: 202, product: { name: 'Agua' } }
        ]
      }
    ],
    payments: []
  }, async (service) => {
    const report = await service.getPosReport(7, '2026-05-14', '2026-05-14');
    assert.equal(report.totals.salesTotal, 0);
    assert.equal(report.totals.pendingTotal, 0);
    assert.equal(report.totals.voidedTotal, 1800);
    assert.equal(report.accounts[0].status, 'VOIDED');
  });
});

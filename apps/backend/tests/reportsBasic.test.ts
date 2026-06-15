import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { ReportsService } from '../src/services/ReportsService';
import { AppError, ErrorCodes } from '../src/errors';
import { prisma } from '../src/prisma';

after(async () => {
  await prisma.$disconnect();
});

const buildPrismaStub = (overrides?: Partial<Record<string, any>>) => ({
  club: {
    findUnique: async () => ({
      id: 10,
      settings: { timeZone: 'America/Argentina/Cordoba' },
    }),
  },
  payment: {
    findMany: async () => [],
  },
  booking: {
    findMany: async () => [],
  },
  account: {
    findMany: async () => [],
  },
  refund: {
    findMany: async () => [],
  },
  ...overrides,
});

const buildCashServiceStub = (overrides?: Partial<{ getPosReport: (...args: any[]) => Promise<any> }>) => ({
  getPosReport: async () => ({
    totals: {
      salesTotal: 0,
      paidTotal: 0,
      pendingTotal: 0,
      voidedTotal: 0,
      productTotal: 0,
      serviceTotal: 0,
    },
    paymentsByMethod: [],
    accounts: [],
    byProduct: [],
    byService: [],
  }),
  ...overrides,
});

test('ingresos por rango vacío devuelven totales en cero', async () => {
  const service = new ReportsService({
    prismaClient: buildPrismaStub() as any,
    cashService: buildCashServiceStub() as any,
  });

  const report = await service.getAdminDashboardReport(10, '2026-05-01', '2026-05-31');

  assert.equal(report.income.totals.collectedTotal, 0);
  assert.equal(report.income.totals.pendingTotal, 0);
  assert.equal(report.bookings.total, 0);
  assert.equal(report.pendingAccounts.accounts.length, 0);
  assert.equal(report.pos.totals.salesTotal, 0);
});

test('ingresos con pagos agregan por método y por origen', async () => {
  const service = new ReportsService({
    prismaClient: buildPrismaStub({
      payment: {
        findMany: async () => [
          { id: 'p1', amount: 1000, method: 'CASH', account: { sourceType: 'BOOKING' } },
          { id: 'p2', amount: 2500, method: 'CARD', account: { sourceType: 'BAR' } },
          { id: 'p3', amount: 500, method: 'CARD', account: { sourceType: 'BAR' } },
        ],
      },
    }) as any,
    cashService: buildCashServiceStub() as any,
  });

  const report = await service.getAdminDashboardReport(10, '2026-05-01', '2026-05-31');

  assert.equal(report.income.totals.collectedTotal, 4000);
  assert.deepEqual(
    report.income.byMethod.map((row) => [row.method, row.count, row.total]),
    [
      ['CARD', 2, 3000],
      ['CASH', 1, 1000],
    ]
  );
  assert.deepEqual(
    report.income.byAccountSource.map((row) => [row.sourceType, row.count, row.total]),
    [
      ['BAR', 2, 3000],
      ['BOOKING', 1, 1000],
    ]
  );
});

test('reservas por estado agrupan correctamente', async () => {
  const service = new ReportsService({
    prismaClient: buildPrismaStub({
      booking: {
        findMany: async () => [
          { status: 'PENDING' },
          { status: 'CONFIRMED' },
          { status: 'CONFIRMED' },
          { status: 'COMPLETED' },
          { status: 'CANCELLED' },
        ],
      },
    }) as any,
    cashService: buildCashServiceStub() as any,
  });

  const report = await service.getAdminDashboardReport(10, '2026-05-01', '2026-05-31');
  const byStatus = Object.fromEntries(report.bookings.byStatus.map((row) => [row.status, row.count]));

  assert.equal(report.bookings.total, 5);
  assert.equal(byStatus.PENDING, 1);
  assert.equal(byStatus.CONFIRMED, 2);
  assert.equal(byStatus.COMPLETED, 1);
  assert.equal(byStatus.CANCELLED, 1);
});

test('cuentas pendientes listan origen, saldo y antigüedad', async () => {
  const service = new ReportsService({
    prismaClient: buildPrismaStub({
      account: {
        findMany: async () => [
          {
            id: 'acc-1',
            displayCode: 'ACC-1',
            sourceType: 'BOOKING',
            sourceId: '201',
            status: 'OPEN',
            totalAmount: 3000,
            paidAmount: 1000,
            createdAt: new Date('2026-05-01T12:00:00.000Z'),
            client: { name: 'Juan Perez' },
          },
          {
            id: 'acc-2',
            displayCode: 'ACC-2',
            sourceType: 'BAR',
            sourceId: 'VOID-xyz',
            status: 'CLOSED',
            totalAmount: 500,
            paidAmount: 0,
            createdAt: new Date('2026-05-02T12:00:00.000Z'),
            client: null,
          },
        ],
      },
    }) as any,
    cashService: buildCashServiceStub() as any,
  });

  const report = await service.getAdminDashboardReport(10, '2026-05-01', '2026-05-10');

  assert.equal(report.pendingAccounts.openCount, 1);
  assert.equal(report.pendingAccounts.totalPending, 2000);
  assert.equal(report.pendingAccounts.accounts[0].sourceType, 'BOOKING');
  assert.equal(report.pendingAccounts.accounts[0].clientName, 'Juan Perez');
  assert.equal(report.pendingAccounts.accounts[0].pending, 2000);
});

test('reutiliza POS report para el resumen integrado', async () => {
  let capturedArgs: unknown[] = [];
  const service = new ReportsService({
    prismaClient: buildPrismaStub() as any,
    cashService: buildCashServiceStub({
      getPosReport: async (...args: unknown[]) => {
        capturedArgs = args;
        return {
          totals: {
            salesTotal: 5500,
            paidTotal: 4000,
            pendingTotal: 1500,
            voidedTotal: 300,
            productTotal: 3500,
            serviceTotal: 2000,
          },
          paymentsByMethod: [{ method: 'CASH', count: 2, total: 4000 }],
          accounts: [
            { id: '1', status: 'OPEN' },
            { id: '2', status: 'CLOSED' },
          ],
          byProduct: [{ productId: 7, name: 'Pelota', quantity: 4, total: 3500 }],
          byService: [{ name: 'Clase', quantity: 2, total: 2000 }],
        };
      },
    }) as any,
  });

  const report = await service.getAdminDashboardReport(10, '2026-05-01', '2026-05-31');

  assert.deepEqual(capturedArgs, [10, '2026-05-01', '2026-05-31']);
  assert.equal(report.pos.totals.salesTotal, 5500);
  assert.equal(report.pos.openAccountsCount, 1);
  assert.equal(report.pos.closedAccountsCount, 1);
  assert.equal(report.income.totals.voidedTotal, 300);
});

test('filtros inválidos devuelven VALIDATION_ERROR con fieldErrors', async () => {
  const service = new ReportsService({
    prismaClient: buildPrismaStub() as any,
    cashService: buildCashServiceStub() as any,
  });

  await assert.rejects(
    () => service.getAdminDashboardReport(10, '2026-05-31', '2026-05-01'),
    (error: any) =>
      error instanceof AppError &&
      error.code === ErrorCodes.VALIDATION_ERROR &&
      Boolean(error.fieldErrors?.startDate) &&
      Boolean(error.fieldErrors?.endDate)
  );
});

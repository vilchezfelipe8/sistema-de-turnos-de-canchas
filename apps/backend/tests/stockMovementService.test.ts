import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { StockMovementService } from '../src/services/StockMovementService';

type FakeProduct = { id: number; clubId: number; name: string; stock: number; isCombo: boolean; isActive: boolean };

const buildTx = (products: FakeProduct[]) => {
  const byId = new Map(products.map((product) => [product.id, { ...product }]));
  const movements: any[] = [];
  const tx = {
    product: {
      findFirst: async (args: any) => {
        const product = byId.get(Number(args?.where?.id));
        if (!product || product.clubId !== Number(args?.where?.clubId)) return null;
        return { ...product };
      },
      findMany: async (args: any) =>
        (args?.where?.id?.in || [])
          .map((id: number) => byId.get(Number(id)))
          .filter((product: FakeProduct | undefined) => product && product.clubId === Number(args?.where?.clubId))
          .map((product: FakeProduct) => ({ ...product })),
      update: async (args: any) => {
        const product = byId.get(Number(args.where.id))!;
        const data = args.data.stock;
        if (typeof data === 'number') product.stock = data;
        else if (data?.increment) product.stock += Number(data.increment);
        else if (data?.decrement) product.stock -= Number(data.decrement);
        return { ...product };
      },
      updateMany: async (args: any) => {
        const product = byId.get(Number(args.where.id));
        if (!product || product.clubId !== Number(args.where.clubId)) return { count: 0 };
        if (args.where.stock?.gte !== undefined && product.stock < Number(args.where.stock.gte)) return { count: 0 };
        product.stock -= Number(args.data.stock.decrement || 0);
        return { count: 1 };
      }
    },
    stockMovement: {
      create: async (args: any) => {
        movements.push(args.data);
        return { id: `mov-${movements.length}`, ...args.data };
      }
    }
  };
  return { tx, byId, movements };
};

const withTransaction = async (tx: any, fn: () => Promise<void>) => {
  const original = (prisma as any).$transaction;
  (prisma as any).$transaction = async (callback: any) => callback(tx);
  try {
    await fn();
  } finally {
    (prisma as any).$transaction = original;
  }
};

const service = new StockMovementService();

test('recordTx guarda delta y saldo antes/después leyendo el stock ya actualizado', async () => {
  const { tx, movements } = buildTx([{ id: 1, clubId: 7, name: 'Agua', stock: 8, isCombo: false, isActive: true }]);
  await service.recordTx(tx as any, { clubId: 7, productId: 1, quantity: -2, type: 'SALE', accountId: 'acc-1' });
  assert.equal(movements.length, 1);
  assert.equal(movements[0].quantity, -2);
  assert.equal(movements[0].stockBefore, 10);
  assert.equal(movements[0].stockAfter, 8);
  assert.equal(movements[0].accountId, 'acc-1');
});

test('recordTx ignora deltas en cero', async () => {
  const { tx, movements } = buildTx([{ id: 1, clubId: 7, name: 'Agua', stock: 8, isCombo: false, isActive: true }]);
  const result = await service.recordTx(tx as any, { clubId: 7, productId: 1, quantity: 0, type: 'ADJUSTMENT' });
  assert.equal(result, null);
  assert.equal(movements.length, 0);
});

test('ingreso suma stock y agrupa los movimientos del mismo remito', async () => {
  const { tx, byId, movements } = buildTx([
    { id: 1, clubId: 7, name: 'Agua', stock: 3, isCombo: false, isActive: true },
    { id: 2, clubId: 7, name: 'Gatorade', stock: 0, isCombo: false, isActive: true }
  ]);
  await withTransaction(tx, async () => {
    await service.registerEntry(7, {
      supplier: 'Distribuidora',
      documentNumber: 'R-123',
      items: [{ productId: 1, quantity: 12, unitCost: 900 }, { productId: 2, quantity: 6 }]
    }, 99);
  });
  assert.equal(byId.get(1)!.stock, 15);
  assert.equal(byId.get(2)!.stock, 6);
  assert.equal(movements.length, 2);
  assert.ok(movements.every((movement) => movement.type === 'PURCHASE' && movement.groupId === movements[0].groupId));
  assert.equal(movements[0].documentNumber, 'R-123');
  assert.equal(movements[0].createdByUserId, 99);
  assert.equal(Number(movements[0].unitCost), 900);
  assert.equal(movements[1].unitCost, null);
});

test('conteo físico deja el stock contado y solo registra diferencias', async () => {
  const { tx, byId, movements } = buildTx([
    { id: 1, clubId: 7, name: 'Agua', stock: 10, isCombo: false, isActive: true },
    { id: 2, clubId: 7, name: 'Gatorade', stock: 4, isCombo: false, isActive: true }
  ]);
  let result: any;
  await withTransaction(tx, async () => {
    result = await service.registerCount(7, {
      items: [{ productId: 1, countedQuantity: 7 }, { productId: 2, countedQuantity: 4 }]
    });
  });
  assert.equal(byId.get(1)!.stock, 7);
  assert.equal(movements.length, 1);
  assert.equal(movements[0].type, 'ADJUSTMENT');
  assert.equal(movements[0].quantity, -3);
  assert.equal(movements[0].stockBefore, 10);
  assert.equal(result.unchanged, 1);
});

test('merma sin stock suficiente falla', async () => {
  const { tx, movements } = buildTx([{ id: 1, clubId: 7, name: 'Agua', stock: 1, isCombo: false, isActive: true }]);
  await withTransaction(tx, async () => {
    await assert.rejects(
      service.registerWaste(7, { items: [{ productId: 1, quantity: 2 }] }),
      /No hay stock suficiente/
    );
  });
  assert.equal(movements.length, 0);
});

test('no se puede ingresar stock a un combo ni a un producto de otro club', async () => {
  const { tx } = buildTx([
    { id: 1, clubId: 7, name: 'Combo agua+barrita', stock: 0, isCombo: true, isActive: true },
    { id: 2, clubId: 8, name: 'Agua otro club', stock: 5, isCombo: false, isActive: true }
  ]);
  await withTransaction(tx, async () => {
    await assert.rejects(service.registerEntry(7, { items: [{ productId: 1, quantity: 3 }] }), /combo/);
    await assert.rejects(service.registerEntry(7, { items: [{ productId: 2, quantity: 3 }] }), /no existe/);
  });
});

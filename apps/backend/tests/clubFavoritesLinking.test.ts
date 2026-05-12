import test from 'node:test';
import assert from 'node:assert/strict';
import { ClubFavoriteService } from '../src/services/ClubFavoriteService';
import { prisma } from '../src/prisma';

type FavoriteRow = {
  id: string;
  clubId: number;
  userId: number;
  createdAt: Date;
};

function withMockedTransaction(tx: any, run: () => Promise<void>) {
  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) => fn(tx);
  return run().finally(() => {
    (prisma as any).$transaction = originalTransaction;
  });
}

function buildHarness(options?: { clubs?: number[] }) {
  const clubs = new Set<number>(options?.clubs || [10]);
  const favorites = new Map<string, FavoriteRow>();
  let favoriteCounter = 1;

  const tx: any = {
    club: {
      findUnique: async ({ where }: any) =>
        clubs.has(Number(where?.id)) ? { id: Number(where.id) } : null
    },
    clubFavorite: {
      upsert: async ({ where, create }: any) => {
        const key = `${where.clubId_userId.clubId}:${where.clubId_userId.userId}`;
        const existing = favorites.get(key);
        if (existing) return existing;
        const createdRow: FavoriteRow = {
          id: `fav-${favoriteCounter++}`,
          clubId: Number(create.clubId),
          userId: Number(create.userId),
          createdAt: new Date()
        };
        favorites.set(key, createdRow);
        return createdRow;
      },
      findMany: async ({ where }: any) => {
        return Array.from(favorites.values())
          .filter((item) => Number(item.userId) === Number(where?.userId))
          .map((item) => ({
            ...item,
            club: {
              id: item.clubId,
              slug: `club-${item.clubId}`,
              name: `Club ${item.clubId}`,
              addressLine: 'Calle 1',
              city: 'Cordoba',
              province: 'Cordoba',
              country: 'AR',
              contactInfo: 'contacto'
            }
          }));
      },
      deleteMany: async ({ where }: any) => {
        const key = `${where.clubId}:${where.userId}`;
        const existed = favorites.delete(key);
        return { count: existed ? 1 : 0 };
      }
    }
  };

  const service = new ClubFavoriteService();
  return { service, tx, favorites };
}

test('favorito duplicado no se crea dos veces para mismo usuario y club', async () => {
  const { service, tx, favorites } = buildHarness();

  await withMockedTransaction(tx, async () => {
    const first = await service.markFavorite(7, 10);
    const second = await service.markFavorite(7, 10);
    assert.equal(first.favorite.clubId, 10);
    assert.equal(second.favorite.clubId, 10);
    assert.equal(favorites.size, 1);
  });
});

test('remover favorito de un usuario no afecta favoritos de otro usuario', async () => {
  const { service, tx } = buildHarness();

  await withMockedTransaction(tx, async () => {
    await service.markFavorite(7, 10);
    await service.markFavorite(8, 10);

    const beforeUser7 = await service.listFavorites(7);
    const beforeUser8 = await service.listFavorites(8);
    assert.equal(beforeUser7.length, 1);
    assert.equal(beforeUser8.length, 1);

    await service.removeFavorite(7, 10);

    const afterUser7 = await service.listFavorites(7);
    const afterUser8 = await service.listFavorites(8);
    assert.equal(afterUser7.length, 0);
    assert.equal(afterUser8.length, 1);
    assert.equal(afterUser8[0].userId, 8);
  });
});

test('favoritos del mismo usuario se aislan por club', async () => {
  const { service, tx } = buildHarness({ clubs: [10, 11] });

  await withMockedTransaction(tx, async () => {
    await service.markFavorite(7, 10);
    await service.markFavorite(7, 11);

    const before = await service.listFavorites(7);
    assert.equal(before.length, 2);

    await service.removeFavorite(7, 10);

    const after = await service.listFavorites(7);
    assert.equal(after.length, 1);
    assert.equal(after[0].clubId, 11);
  });
});

test('marcar favorito en club inexistente falla', async () => {
  const { service, tx } = buildHarness({ clubs: [10] });

  await withMockedTransaction(tx, async () => {
    await assert.rejects(() => service.markFavorite(7, 999), /Club no encontrado/);
  });
});

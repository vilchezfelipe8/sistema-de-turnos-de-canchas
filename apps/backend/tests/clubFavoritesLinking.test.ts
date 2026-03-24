import test from 'node:test';
import assert from 'node:assert/strict';
import { ClubFavoriteService } from '../src/services/ClubFavoriteService';
import { prisma } from '../src/prisma';

type MemoryClient = {
  id: string;
  clubId: number;
  userId: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  dni: string | null;
};

function withMockedTransaction(tx: any, run: () => Promise<void>) {
  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) => fn(tx);
  return run().finally(() => {
    (prisma as any).$transaction = originalTransaction;
  });
}

function buildHarness(options?: {
  user?: any;
  clients?: MemoryClient[];
  clubs?: number[];
}) {
  const user = options?.user || {
    id: 7,
    firstName: 'Ada',
    lastName: 'Lovelace',
    phoneNumber: '+5493511234567',
    email: 'ada@example.com',
    dni: '30111222'
  };
  const clubs = new Set<number>(options?.clubs || [10]);
  const clients: MemoryClient[] = Array.isArray(options?.clients) ? [...options!.clients!] : [];
  const favorites = new Map<string, { id: string; clubId: number; userId: number; createdAt: Date }>();
  const incidents: any[] = [];
  let favoriteCounter = 1;
  let clientCounter = 1;
  let incidentCounter = 1;

  const tx: any = {
    club: {
      findUnique: async ({ where }: any) => (clubs.has(Number(where?.id)) ? { id: Number(where.id) } : null)
    },
    user: {
      findUnique: async ({ where }: any) => {
        if (Number(where?.id) !== Number(user.id)) return null;
        return user;
      }
    },
    client: {
      findFirst: async ({ where }: any) => {
        if (where?.clubId == null) return null;
        const clubId = Number(where.clubId);
        if (where?.userId != null) {
          const found = clients.find((c) => c.clubId === clubId && Number(c.userId) === Number(where.userId));
          return found ? { id: found.id, userId: found.userId } : null;
        }
        if (where?.dni != null) {
          const found = clients.find((c) => c.clubId === clubId && c.dni === String(where.dni));
          return found ? { id: found.id, userId: found.userId } : null;
        }
        if (where?.phone != null) {
          const acceptedPhones = Array.isArray(where.phone?.in)
            ? where.phone.in.map((value: any) => String(value))
            : [String(where.phone)];
          const found = clients.find((c) => c.clubId === clubId && acceptedPhones.includes(String(c.phone || '')));
          return found ? { id: found.id, userId: found.userId } : null;
        }
        if (where?.email != null) {
          const found = clients.find((c) => c.clubId === clubId && c.email === String(where.email));
          return found ? { id: found.id, userId: found.userId } : null;
        }
        return null;
      },
      findUnique: async ({ where }: any) => {
        const found = clients.find((c) => c.id === String(where?.id));
        return found ? { id: found.id, userId: found.userId } : null;
      },
      update: async ({ where, data }: any) => {
        const idx = clients.findIndex((c) => c.id === String(where?.id));
        if (idx >= 0) {
          clients[idx] = { ...clients[idx], ...data };
          return { id: clients[idx].id, userId: clients[idx].userId };
        }
        throw new Error('Client not found');
      },
      create: async ({ data }: any) => {
        const created: MemoryClient = {
          id: `c-${clientCounter++}`,
          clubId: Number(data.clubId),
          userId: data.userId == null ? null : Number(data.userId),
          name: String(data.name || ''),
          phone: data.phone ?? null,
          email: data.email ?? null,
          dni: data.dni ?? null
        };
        clients.push(created);
        return { id: created.id };
      }
    },
    clubFavorite: {
      upsert: async ({ where, create }: any) => {
        const key = `${where.clubId_userId.clubId}:${where.clubId_userId.userId}`;
        if (favorites.has(key)) return favorites.get(key);
        const created = {
          id: `fav-${favoriteCounter++}`,
          clubId: Number(create.clubId),
          userId: Number(create.userId),
          createdAt: new Date()
        };
        favorites.set(key, created);
        return created;
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
        favorites.delete(key);
        return { count: 1 };
      }
    },
    clientDuplicateIncident: {
      findFirst: async ({ where }: any) => {
        return incidents.find((item) =>
          Number(item.clubId) === Number(where?.clubId) &&
          String(item.status) === String(where?.status) &&
          String(item.dedupeKey) === String(where?.dedupeKey)
        ) || null;
      },
      create: async ({ data }: any) => {
        const created = {
          id: `inc-${incidentCounter++}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        incidents.push(created);
        return created;
      },
      update: async ({ where, data }: any) => {
        const idx = incidents.findIndex((item) => item.id === String(where?.id));
        if (idx < 0) throw new Error('Incident not found');
        incidents[idx] = { ...incidents[idx], ...data, updatedAt: new Date() };
        return incidents[idx];
      }
    }
  };

  const service = new ClubFavoriteService();
  return { service, tx, clients, favorites, incidents };
}

test('crear favorito repetido no duplica', async () => {
  const { service, tx, favorites } = buildHarness();

  await withMockedTransaction(tx, async () => {
    const first = await service.markFavorite(7, 10);
    const second = await service.markFavorite(7, 10);
    assert.equal(first.favorite.clubId, 10);
    assert.equal(second.favorite.clubId, 10);
    assert.equal(favorites.size, 1);
  });
});

test('eliminar favorito', async () => {
  const { service, tx, favorites } = buildHarness();

  await withMockedTransaction(tx, async () => {
    await service.markFavorite(7, 10);
    assert.equal(favorites.size, 1);
    await service.removeFavorite(7, 10);
    assert.equal(favorites.size, 0);
  });
});

test('listar favoritos del usuario', async () => {
  const { service, tx } = buildHarness();

  await withMockedTransaction(tx, async () => {
    await service.markFavorite(7, 10);
    const list = await service.listFavorites(7);
    assert.equal(Array.isArray(list), true);
    assert.equal(list.length, 1);
    assert.equal(list[0].clubId, 10);
  });
});

test('marcar favorito con client ya vinculado', async () => {
  const { service, tx } = buildHarness({
    clients: [
      {
        id: 'c-linked',
        clubId: 10,
        userId: 7,
        name: 'Ada Lovelace',
        phone: '+5493511234567',
        email: 'ada@example.com',
        dni: '30111222'
      }
    ]
  });

  await withMockedTransaction(tx, async () => {
    const result = await service.markFavorite(7, 10);
    assert.equal(result.linking.status, 'already_linked');
    assert.equal(result.linking.clientId, 'c-linked');
  });
});

test('marcar favorito y vincular por match fuerte', async () => {
  const { service, tx, clients } = buildHarness({
    clients: [
      {
        id: 'c-strong',
        clubId: 10,
        userId: null,
        name: 'Cliente',
        phone: '+5493511234567',
        email: 'other@example.com',
        dni: null
      }
    ]
  });

  await withMockedTransaction(tx, async () => {
    const result = await service.markFavorite(7, 10);
    assert.equal(result.linking.status, 'linked_existing_client');
    assert.equal(result.linking.clientId, 'c-strong');
    const updated = clients.find((c) => c.id === 'c-strong');
    assert.equal(updated?.userId, 7);
  });
});

test('marcar favorito y crear Client nuevo', async () => {
  const { service, tx, clients } = buildHarness({
    user: {
      id: 7,
      firstName: 'Ada',
      lastName: 'Lovelace',
      phoneNumber: '+5493511112222',
      email: 'new@example.com',
      dni: ''
    }
  });

  await withMockedTransaction(tx, async () => {
    const result = await service.markFavorite(7, 10);
    assert.equal(result.linking.status, 'created_client');
    assert.equal(clients.length, 1);
    assert.equal(clients[0].userId, 7);
    assert.equal(clients[0].phone, '+5493511112222');
  });
});

test('marcar favorito con duplicado ambiguo: favorito sí, link no', async () => {
  const { service, tx, favorites, clients, incidents } = buildHarness({
    clients: [
      {
        id: 'c-phone',
        clubId: 10,
        userId: null,
        name: 'Cliente A',
        phone: '+5493511234567',
        email: null,
        dni: null
      },
      {
        id: 'c-email',
        clubId: 10,
        userId: null,
        name: 'Cliente B',
        phone: null,
        email: 'ada@example.com',
        dni: null
      }
    ]
  });

  await withMockedTransaction(tx, async () => {
    const result = await service.markFavorite(7, 10);
    assert.equal(result.linking.status, 'duplicate_detected_no_link');
    assert.equal(result.linking.clientId, null);
    assert.equal(favorites.size, 1);
    assert.equal(clients.some((c) => c.userId === 7), false);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].sourceType, 'FAVORITE');
    assert.equal(incidents[0].status, 'OPEN');
  });
});

test('favoritos matchea cliente existente aunque llegue teléfono en formato local', async () => {
  const { service, tx, clients } = buildHarness({
    user: {
      id: 7,
      firstName: 'Ada',
      lastName: 'Lovelace',
      phoneNumber: '+54 9 351-123-4567',
      email: '',
      dni: ''
    },
    clients: [
      {
        id: 'c-phone-normalized',
        clubId: 10,
        userId: null,
        name: 'Ada',
        phone: '+5493511234567',
        email: null,
        dni: null
      }
    ]
  });

  await withMockedTransaction(tx, async () => {
    const result = await service.markFavorite(7, 10);
    assert.equal(result.linking.status, 'linked_existing_client');
    assert.equal(result.linking.clientId, 'c-phone-normalized');
    assert.equal(clients.find((c) => c.id === 'c-phone-normalized')?.userId, 7);
  });
});

test('nunca resuelve por nombre solo', async () => {
  const { service, tx, clients } = buildHarness({
    user: {
      id: 7,
      firstName: 'Ada',
      lastName: 'Lovelace',
      phoneNumber: '',
      email: '',
      dni: ''
    },
    clients: [
      {
        id: 'c-name',
        clubId: 10,
        userId: null,
        name: 'Ada Lovelace',
        phone: null,
        email: null,
        dni: null
      }
    ]
  });

  await withMockedTransaction(tx, async () => {
    const result = await service.markFavorite(7, 10);
    assert.equal(result.linking.status, 'insufficient_data_no_link');
    assert.equal(result.linking.clientId, null);
    assert.equal(clients.find((c) => c.id === 'c-name')?.userId, null);
  });
});

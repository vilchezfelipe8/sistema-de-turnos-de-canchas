import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingService } from '../src/services/BookingService';
import { AppError } from '../src/errors';

type MemoryClient = {
  id: string;
  clubId: number;
  userId: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  dni: string | null;
  createdAt?: Date;
};

function buildTx(clients: MemoryClient[]) {
  const auditLogs: any[] = [];
  const tx: any = {
    client: {
      findFirst: async ({ where }: any) => {
        const clubId = Number(where?.clubId);
        const matchesUserId = (row: MemoryClient) => {
          if (!Object.prototype.hasOwnProperty.call(where || {}, 'userId')) return true;
          if (where.userId === null) return row.userId === null;
          return Number(row.userId) === Number(where.userId);
        };
        if (where?.userId != null && !where?.dni && !where?.phone && !where?.email) {
          return clients.find((row) => row.clubId === clubId && matchesUserId(row)) || null;
        }
        if (where?.dni != null) {
          return clients.find((row) => row.clubId === clubId && matchesUserId(row) && row.dni === String(where.dni)) || null;
        }
        if (where?.phone?.in) {
          const accepted = new Set((where.phone.in || []).map((value: any) => String(value)));
          return clients.find((row) => row.clubId === clubId && matchesUserId(row) && accepted.has(String(row.phone || ''))) || null;
        }
        if (where?.email != null) {
          return clients.find((row) => row.clubId === clubId && matchesUserId(row) && row.email === String(where.email)) || null;
        }
        return null;
      },
      findMany: async ({ where }: any) => {
        const clubId = Number(where?.clubId);
        let rows = clients.filter((row) => row.clubId === clubId);
        if (where?.dni != null) {
          rows = rows.filter((row) => row.dni === String(where.dni));
        }
        if (where?.email != null) {
          rows = rows.filter((row) => row.email === String(where.email));
        }
        if (where?.phone?.in) {
          const accepted = new Set((where.phone.in || []).map((value: any) => String(value)));
          rows = rows.filter((row) => accepted.has(String(row.phone || '')));
        }
        return [...rows].sort((left, right) => {
          const leftCreatedAt = left.createdAt ? left.createdAt.getTime() : Number.MAX_SAFE_INTEGER;
          const rightCreatedAt = right.createdAt ? right.createdAt.getTime() : Number.MAX_SAFE_INTEGER;
          if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
          return String(left.id).localeCompare(String(right.id));
        });
      },
      findUnique: async ({ where }: any) => {
        return clients.find((row) => String(row.id) === String(where?.id)) || null;
      },
      update: async ({ where, data }: any) => {
        const idx = clients.findIndex((row) => String(row.id) === String(where?.id));
        if (idx < 0) throw new Error('Client not found');
        clients[idx] = { ...clients[idx], ...data };
        return clients[idx];
      },
      create: async ({ data }: any) => {
        const created: MemoryClient = {
          id: `c-${clients.length + 1}`,
          clubId: Number(data.clubId),
          userId: data.userId == null ? null : Number(data.userId),
          name: String(data.name || ''),
          phone: data.phone ?? null,
          email: data.email ?? null,
          dni: data.dni ?? null,
          createdAt: new Date(`2026-05-20T00:00:0${clients.length + 1}.000Z`)
        };
        clients.push(created);
        return created;
      }
    },
    auditLog: {
      create: async ({ data }: any) => {
        const created = { id: `audit-${auditLogs.length + 1}`, ...data, createdAt: new Date() };
        auditLogs.push(created);
        return created;
      }
    }
  };
  return { tx, clients, auditLogs };
}

function createService() {
  return new BookingService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
}

test('usuario logueado reutiliza client existente por email sin auto-linkear userId', async () => {
  const { tx, clients, auditLogs } = buildTx([
    {
      id: 'c-email',
      clubId: 10,
      userId: null,
      name: 'Admin Las Tejas',
      phone: '+5493571359791',
      email: 'admin@lastejas.com',
      dni: null,
      createdAt: new Date('2026-05-19T20:00:00.000Z')
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: 7,
    name: 'Admin Las Tejas',
    phone: '+54 9 357 135 9791',
    email: 'ADMIN@LASTEJAS.COM',
    dni: ''
  });

  assert.equal(resolved.id, 'c-email');
  assert.equal(clients.length, 1);
  assert.equal(clients[0].userId, null);
  assert.equal(auditLogs.some((row) => row.payload?.reason === 'ALREADY_LINKED'), false);
});

test('alta rápida admin reutiliza client existente por teléfono normalizado', async () => {
  const { tx, clients } = buildTx([
    {
      id: 'c-phone',
      clubId: 10,
      userId: null,
      name: 'Admin Las Tejas',
      phone: '+5493571359791',
      email: null,
      dni: null,
      createdAt: new Date('2026-05-19T20:00:00.000Z')
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Admin Las Tejas',
    phone: '+54 9 357 135 9791',
    email: '',
    dni: ''
  });

  assert.equal(resolved.id, 'c-phone');
  assert.equal(clients.length, 1);
});

test('alta rápida admin reutiliza client existente por DNI normalizado', async () => {
  const { tx, clients } = buildTx([
    {
      id: 'c-dni',
      clubId: 10,
      userId: null,
      name: 'Admin Las Tejas',
      phone: null,
      email: null,
      dni: '30111222',
      createdAt: new Date('2026-05-19T20:00:00.000Z')
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Admin Las Tejas',
    phone: '+54 9 357 135 9791',
    email: '',
    dni: '30.111.222'
  });

  assert.equal(resolved.id, 'c-dni');
  assert.equal(clients.length, 1);
});

test('si solo coincide por nombre puede crear un client nuevo', async () => {
  const { tx, clients } = buildTx([
    {
      id: 'c-name',
      clubId: 10,
      userId: null,
      name: 'Admin Las Tejas',
      phone: null,
      email: null,
      dni: null,
      createdAt: new Date('2026-05-19T20:00:00.000Z')
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Admin Las Tejas',
    phone: '+54 9 357 135 9791',
    email: '',
    dni: ''
  });

  assert.notEqual(resolved.id, 'c-name');
  assert.equal(clients.length, 2);
});

test('si ya existe client vinculado al user se reutiliza ese mismo client', async () => {
  const { tx, clients, auditLogs } = buildTx([
    {
      id: 'c-linked',
      clubId: 10,
      userId: 42,
      name: 'Usuario Vinculado',
      phone: '+5493511234567',
      email: 'linked@example.com',
      dni: null,
      createdAt: new Date('2026-05-19T20:00:00.000Z')
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: 42,
    name: 'Usuario Vinculado',
    phone: '+5493511234567',
    email: 'linked@example.com',
    dni: ''
  });

  assert.equal(resolved.id, 'c-linked');
  assert.equal(clients.length, 1);
  assert.ok(auditLogs.some((row) => row.payload?.reason === 'ALREADY_LINKED'));
});

test('si existen dos clients candidatos por identidad fuerte no elige uno arbitrariamente', async () => {
  const { tx, clients } = buildTx([
    {
      id: 'c-old',
      clubId: 10,
      userId: null,
      name: 'Admin Las Tejas',
      phone: '+5493571359791',
      email: 'admin@lastejas.com',
      dni: null,
      createdAt: new Date('2026-05-19T20:00:00.000Z')
    },
    {
      id: 'c-new',
      clubId: 10,
      userId: null,
      name: 'Admin Las Tejas',
      phone: '+5493571359791',
      email: 'admin@lastejas.com',
      dni: null,
      createdAt: new Date('2026-05-19T21:02:15.856Z')
    }
  ]);
  const service = createService();

  await assert.rejects(
    () => (service as any).resolveOrCreateClient(tx, {
      clubId: 10,
      userId: null,
      name: 'Admin Las Tejas',
      phone: '+54 9 357 135 9791',
      email: 'admin@lastejas.com',
      dni: ''
    }),
    (error: any) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'CLIENT_POSSIBLE_DUPLICATE');
      assert.deepEqual(error.meta?.candidateClientIds, ['c-old', 'c-new']);
      return true;
    }
  );
  assert.equal(clients.length, 2);
});

test('si el admin fuerza crear nuevo, resolveOrCreateClient permite crear aun con candidatos fuertes múltiples', async () => {
  const { tx, clients } = buildTx([
    {
      id: 'c-old',
      clubId: 10,
      userId: null,
      name: 'Admin Las Tejas',
      phone: '+5493571359791',
      email: 'admin@lastejas.com',
      dni: null,
      createdAt: new Date('2026-05-19T20:00:00.000Z')
    },
    {
      id: 'c-new',
      clubId: 10,
      userId: null,
      name: 'Admin Las Tejas',
      phone: '+5493571359791',
      email: 'admin@lastejas.com',
      dni: null,
      createdAt: new Date('2026-05-19T21:02:15.856Z')
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Admin Las Tejas',
    phone: '+54 9 357 135 9791',
    email: 'admin@lastejas.com',
    dni: '',
    forceCreateNew: true
  });

  assert.equal(clients.length, 3);
  assert.equal(resolved.id, 'c-3');
});

test('clientes de otros clubes no se mezclan al resolver identidad fuerte', async () => {
  const { tx, clients } = buildTx([
    {
      id: 'c-other-club',
      clubId: 99,
      userId: null,
      name: 'Cliente Otro Club',
      phone: '+5493571359791',
      email: 'admin@lastejas.com',
      dni: '30111222',
      createdAt: new Date('2026-05-19T20:00:00.000Z')
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Admin Las Tejas',
    phone: '+54 9 357 135 9791',
    email: 'admin@lastejas.com',
    dni: '30111222'
  });

  assert.equal(resolved.id, 'c-2');
  assert.equal(clients.length, 2);
  assert.equal(clients[1].clubId, 10);
});

test('reintentar la resolución con la misma identidad no crea un segundo client', async () => {
  const { tx, clients } = buildTx([]);
  const service = createService();

  const first = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Cliente Nuevo',
    phone: '+54 9 357 135 9791',
    email: 'cliente@ejemplo.com',
    dni: ''
  });

  const second = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Cliente Nuevo',
    phone: '+5493571359791',
    email: 'CLIENTE@EJEMPLO.COM',
    dni: ''
  });

  assert.equal(first.id, second.id);
  assert.equal(clients.length, 1);
});

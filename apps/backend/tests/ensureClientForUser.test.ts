import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { PersonService } from '../src/services/PersonService';
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

type MemoryUser = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phoneNumber: string | null;
  dni: string | null;
};

function buildTransactionHarness(input: {
  clients: MemoryClient[];
  users: MemoryUser[];
}) {
  const clients = [...input.clients];
  const users = [...input.users];
  const auditLogs: any[] = [];

  const tx: any = {
    $executeRaw: async () => 1,
    user: {
      findUnique: async ({ where }: any) =>
        users.find((row) => Number(row.id) === Number(where?.id)) || null
    },
    client: {
      findFirst: async ({ where }: any) => {
        const clubId = Number(where?.clubId);
        let rows = clients.filter((row) => row.clubId === clubId);
        if (Object.prototype.hasOwnProperty.call(where || {}, 'userId')) {
          rows = rows.filter((row) => {
            if (where.userId === null) return row.userId === null;
            return Number(row.userId || 0) === Number(where.userId || 0);
          });
        }
        return rows[0] || null;
      },
      findMany: async ({ where }: any) => {
        const clubId = Number(where?.clubId);
        let rows = clients.filter((row) => row.clubId === clubId);
        if (where?.dni != null) rows = rows.filter((row) => row.dni === String(where.dni));
        if (where?.email != null) rows = rows.filter((row) => row.email === String(where.email));
        if (where?.phone?.in) {
          const variants = new Set((where.phone.in || []).map((value: unknown) => String(value)));
          rows = rows.filter((row) => variants.has(String(row.phone || '')));
        }
        return [...rows].sort((left, right) => {
          const leftAt = left.createdAt ? left.createdAt.getTime() : Number.MAX_SAFE_INTEGER;
          const rightAt = right.createdAt ? right.createdAt.getTime() : Number.MAX_SAFE_INTEGER;
          if (leftAt !== rightAt) return leftAt - rightAt;
          return String(left.id).localeCompare(String(right.id));
        });
      },
      update: async ({ where, data }: any) => {
        const index = clients.findIndex((row) => String(row.id) === String(where?.id));
        if (index < 0) throw new Error('Client not found');
        clients[index] = { ...clients[index], ...data };
        return clients[index];
      },
      create: async ({ data }: any) => {
        const created: MemoryClient = {
          id: `client-${clients.length + 1}`,
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
        const created = { id: `audit-${auditLogs.length + 1}`, ...data };
        auditLogs.push(created);
        return created;
      }
    }
  };

  return { tx, clients, users, auditLogs };
}

const createService = () => new PersonService();

test('ensureClientForUser crea un client del club si no existe', async () => {
  const originalTransaction = (prisma as any).$transaction;
  const harness = buildTransactionHarness({
    clients: [],
    users: [
      {
        id: 9,
        firstName: 'Lucía',
        lastName: 'Díaz',
        email: 'lucia@pique.test',
        phoneNumber: '+5493515554444',
        dni: '30111222'
      }
    ]
  });
  (prisma as any).$transaction = async (callback: any) => callback(harness.tx);

  try {
    const client = await createService().ensureClientForUser(5, 9, { source: 'ADMIN_SELECTED_USER' });
    assert.equal(client.userId, 9);
    assert.equal(harness.clients.length, 1);
    assert.equal(harness.clients[0].clubId, 5);
    assert.equal(harness.auditLogs.length, 1);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('ensureClientForUser reutiliza client ya vinculado en el club', async () => {
  const originalTransaction = (prisma as any).$transaction;
  const harness = buildTransactionHarness({
    clients: [
      {
        id: 'client-linked',
        clubId: 5,
        userId: 9,
        name: 'Lucía Díaz',
        phone: '+5493515554444',
        email: 'lucia@pique.test',
        dni: '30111222',
        createdAt: new Date('2026-05-20T10:00:00.000Z')
      }
    ],
    users: [
      {
        id: 9,
        firstName: 'Lucía',
        lastName: 'Díaz',
        email: 'lucia@pique.test',
        phoneNumber: '+5493515554444',
        dni: '30111222'
      }
    ]
  });
  (prisma as any).$transaction = async (callback: any) => callback(harness.tx);

  try {
    const client = await createService().ensureClientForUser(5, 9, { source: 'ADMIN_SELECTED_USER' });
    assert.equal(client.id, 'client-linked');
    assert.equal(harness.clients.length, 1);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('ensureClientForUser reutiliza client fuerte por email/teléfono y lo vincula', async () => {
  const originalTransaction = (prisma as any).$transaction;
  const harness = buildTransactionHarness({
    clients: [
      {
        id: 'client-existing',
        clubId: 5,
        userId: null,
        name: 'Lucía Díaz',
        phone: '+5493515554444',
        email: 'lucia@pique.test',
        dni: null,
        createdAt: new Date('2026-05-20T09:00:00.000Z')
      }
    ],
    users: [
      {
        id: 9,
        firstName: 'Lucía',
        lastName: 'Díaz',
        email: 'lucia@pique.test',
        phoneNumber: '+5493515554444',
        dni: null
      }
    ]
  });
  (prisma as any).$transaction = async (callback: any) => callback(harness.tx);

  try {
    const client = await createService().ensureClientForUser(5, 9, { source: 'ADMIN_SELECTED_USER' });
    assert.equal(client.id, 'client-existing');
    assert.equal(client.userId, 9);
    assert.equal(harness.clients.length, 1);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('ensureClientForUser no elige arbitrariamente si hay múltiples clients candidatos por identidad fuerte', async () => {
  const originalTransaction = (prisma as any).$transaction;
  const harness = buildTransactionHarness({
    clients: [
      {
        id: 'client-a',
        clubId: 5,
        userId: null,
        name: 'Familia Uno',
        phone: '+5493515554444',
        email: 'familia@pique.test',
        dni: null,
        createdAt: new Date('2026-05-20T09:00:00.000Z')
      },
      {
        id: 'client-b',
        clubId: 5,
        userId: null,
        name: 'Familia Dos',
        phone: '+5493515554444',
        email: 'familia@pique.test',
        dni: null,
        createdAt: new Date('2026-05-20T10:00:00.000Z')
      }
    ],
    users: [
      {
        id: 9,
        firstName: 'Lucía',
        lastName: 'Díaz',
        email: 'familia@pique.test',
        phoneNumber: '+5493515554444',
        dni: null
      }
    ]
  });
  (prisma as any).$transaction = async (callback: any) => callback(harness.tx);

  try {
    await assert.rejects(
      () => createService().ensureClientForUser(5, 9, { source: 'ADMIN_SELECTED_USER' }),
      (error: any) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'CLIENT_POSSIBLE_DUPLICATE');
        assert.deepEqual(error.meta?.candidateClientIds, ['client-a', 'client-b']);
        return true;
      }
    );
    assert.equal(harness.clients.length, 2);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('ensureClientForUser no crea duplicado en reintento', async () => {
  const originalTransaction = (prisma as any).$transaction;
  const harness = buildTransactionHarness({
    clients: [],
    users: [
      {
        id: 9,
        firstName: 'Lucía',
        lastName: 'Díaz',
        email: 'lucia@pique.test',
        phoneNumber: '+5493515554444',
        dni: null
      }
    ]
  });
  (prisma as any).$transaction = async (callback: any) => callback(harness.tx);

  try {
    const service = createService();
    const first = await service.ensureClientForUser(5, 9, { source: 'ADMIN_SELECTED_USER' });
    const second = await service.ensureClientForUser(5, 9, { source: 'ADMIN_SELECTED_USER' });
    assert.equal(first.id, second.id);
    assert.equal(harness.clients.length, 1);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

test('ensureClientForUser respeta clubId y no reutiliza clients de otros clubes', async () => {
  const originalTransaction = (prisma as any).$transaction;
  const harness = buildTransactionHarness({
    clients: [
      {
        id: 'client-other-club',
        clubId: 99,
        userId: 9,
        name: 'Lucía Díaz',
        phone: '+5493515554444',
        email: 'lucia@pique.test',
        dni: null,
        createdAt: new Date('2026-05-20T09:00:00.000Z')
      }
    ],
    users: [
      {
        id: 9,
        firstName: 'Lucía',
        lastName: 'Díaz',
        email: 'lucia@pique.test',
        phoneNumber: '+5493515554444',
        dni: null
      }
    ]
  });
  (prisma as any).$transaction = async (callback: any) => callback(harness.tx);

  try {
    const client = await createService().ensureClientForUser(5, 9, { source: 'ADMIN_SELECTED_USER' });
    assert.notEqual(client.id, 'client-other-club');
    assert.equal(client.clubId, 5);
    assert.equal(harness.clients.length, 2);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});

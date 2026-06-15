import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { ClubService } from '../src/services/ClubService';
import { AppError, ErrorCodes } from '../src/errors';

type ClientRow = {
  id: string;
  clubId: number;
  name: string;
  phone: string | null;
  email: string | null;
  dni: string | null;
  userId: number | null;
  isProfessor: boolean;
  createdAt: Date;
};

function createService() {
  return new ClubService({} as any, {} as any);
}

function buildState() {
  return {
    clients: [
      {
        id: 'client-1',
        clubId: 5,
        name: 'Juan Padre',
        phone: '+5493511111111',
        email: 'familia@pique.test',
        dni: '30111222',
        userId: null,
        isProfessor: false,
        createdAt: new Date('2026-05-20T10:00:00.000Z')
      },
      {
        id: 'client-2',
        clubId: 5,
        name: 'Juan Hijo',
        phone: '+5493511111111',
        email: 'familia@pique.test',
        dni: '30111223',
        userId: null,
        isProfessor: false,
        createdAt: new Date('2026-05-20T11:00:00.000Z')
      },
      {
        id: 'client-other-club',
        clubId: 99,
        name: 'Cliente Otro Club',
        phone: '+5493511111111',
        email: 'familia@pique.test',
        dni: '30111222',
        userId: null,
        isProfessor: false,
        createdAt: new Date('2026-05-20T12:00:00.000Z')
      }
    ] as ClientRow[],
    created: [] as ClientRow[]
  };
}

async function withMockedPrisma(run: (state: ReturnType<typeof buildState>) => Promise<void>) {
  const state = buildState();
  const originalTransaction = (prisma as any).$transaction;
  const originalClubFindUnique = (prisma as any).club.findUnique;

  const tx: any = {
    $executeRaw: async () => 1,
    client: {
      findMany: async ({ where }: any) => {
        const rows = state.clients.filter((row) => Number(row.clubId) === Number(where?.clubId));
        const filters = Array.isArray(where?.OR) ? where.OR : [];
        return rows.filter((row) =>
          filters.some((filter: any) => {
            if (filter?.dni) return String(row.dni || '') === String(filter.dni);
            if (filter?.email) return String(row.email || '') === String(filter.email);
            if (Array.isArray(filter?.phone?.in)) return filter.phone.in.includes(String(row.phone || ''));
            return false;
          })
        );
      },
      create: async ({ data }: any) => {
        const created: ClientRow = {
          id: `created-${state.created.length + 1}`,
          clubId: Number(data.clubId),
          name: String(data.name),
          phone: data.phone || null,
          email: data.email || null,
          dni: data.dni || null,
          userId: data.userId ?? null,
          isProfessor: Boolean(data.isProfessor),
          createdAt: new Date(`2026-05-21T1${state.created.length}:00:00.000Z`)
        };
        state.clients.push(created);
        state.created.push(created);
        return created;
      }
    }
  };

  (prisma as any).club.findUnique = async () => ({ country: 'AR' });
  (prisma as any).$transaction = async (fn: any) => fn(tx);

  try {
    await run(state);
  } finally {
    (prisma as any).$transaction = originalTransaction;
    (prisma as any).club.findUnique = originalClubFindUnique;
  }
}

test('createClient sin coincidencias crea normal', async () => {
  const service = createService();

  await withMockedPrisma(async (state) => {
    const created = await service.createClient(5, {
      name: 'Cliente Nuevo',
      phone: '+5493519990000',
      email: 'nuevo@pique.test',
      dni: '30999111'
    });

    assert.equal(String(created.name), 'Cliente Nuevo');
    assert.equal(state.created.length, 1);
  });
});

test('createClient con teléfono repetido devuelve CLIENT_POSSIBLE_DUPLICATE', async () => {
  const service = createService();

  await withMockedPrisma(async () => {
    await assert.rejects(
      () =>
        service.createClient(5, {
          name: 'Otro Cliente',
          phone: '+54 9 351 111 1111'
        }),
      (error: any) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, ErrorCodes.CLIENT_POSSIBLE_DUPLICATE);
        assert.deepEqual(error.meta?.candidateClientIds, ['client-1', 'client-2']);
        return true;
      }
    );
  });
});

test('createClient con email repetido devuelve CLIENT_POSSIBLE_DUPLICATE', async () => {
  const service = createService();

  await withMockedPrisma(async () => {
    await assert.rejects(
      () =>
        service.createClient(5, {
          name: 'Otro Cliente',
          phone: '+5493519990000',
          email: 'familia@pique.test'
        }),
      (error: any) => {
        assert.equal(error.code, ErrorCodes.CLIENT_POSSIBLE_DUPLICATE);
        assert.deepEqual(error.meta?.candidateClientIds, ['client-1', 'client-2']);
        return true;
      }
    );
  });
});

test('createClient con dni repetido devuelve CLIENT_POSSIBLE_DUPLICATE', async () => {
  const service = createService();

  await withMockedPrisma(async () => {
    await assert.rejects(
      () =>
        service.createClient(5, {
          name: 'Otro Cliente',
          phone: '+5493519990000',
          dni: '30111222'
        }),
      (error: any) => {
        assert.equal(error.code, ErrorCodes.CLIENT_POSSIBLE_DUPLICATE);
        assert.deepEqual(error.meta?.candidateClientIds, ['client-1']);
        return true;
      }
    );
  });
});

test('createClient con forceCreateNew crea igual aunque haya coincidencias', async () => {
  const service = createService();

  await withMockedPrisma(async (state) => {
    const created = await service.createClient(5, {
      name: 'Juan Nieto',
      phone: '+5493511111111',
      email: 'familia@pique.test',
      forceCreateNew: true
    });

    assert.equal(String(created.id), 'created-1');
    assert.equal(state.created.length, 1);
  });
});

test('createClient no toma clients de otro club como duplicado', async () => {
  const service = createService();

  await withMockedPrisma(async (state) => {
    state.clients = state.clients.filter((row) => row.clubId !== 5);

    const created = await service.createClient(5, {
      name: 'Cliente Club 5',
      phone: '+5493511111111',
      email: 'familia@pique.test',
      dni: '30111222'
    });

    assert.equal(String(created.id), 'created-1');
  });
});

test('createClient no usa nombre como duplicado fuerte', async () => {
  const service = createService();

  await withMockedPrisma(async (state) => {
    state.clients = [
      {
        id: 'name-only',
        clubId: 5,
        name: 'Cliente Compartido',
        phone: '+5493510000001',
        email: 'a@pique.test',
        dni: '30000001',
        userId: null,
        isProfessor: false,
        createdAt: new Date('2026-05-20T10:00:00.000Z')
      }
    ];

    const created = await service.createClient(5, {
      name: 'Cliente Compartido',
      phone: '+5493519990000',
      email: 'b@pique.test',
      dni: '30000002'
    });

    assert.equal(String(created.id), 'created-1');
  });
});

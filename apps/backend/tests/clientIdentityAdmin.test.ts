import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { ClientIdentityAdminService } from '../src/services/ClientIdentityAdminService';
import { AppError, ErrorCodes } from '../src/errors';

type MockState = ReturnType<typeof buildState>;

function buildState() {
  return {
    clients: [
      {
        id: 'c-1',
        clubId: 10,
        userId: null,
        name: 'Cliente Uno',
        phone: '+5493511111111',
        email: 'uno@test.com',
        dni: '30111222',
        isProfessor: false,
      },
      {
        id: 'c-2',
        clubId: 10,
        userId: null,
        name: 'Cliente Dos',
        phone: '+5493512222222',
        email: 'dos@test.com',
        dni: '30222333',
        isProfessor: true,
      },
      {
        id: 'c-x',
        clubId: 99,
        userId: null,
        name: 'Cliente Otro Club',
        phone: '+5491111111111',
        email: 'otro@test.com',
        dni: '39999999',
        isProfessor: false,
      },
    ] as Array<{
      id: string;
      clubId: number;
      userId: number | null;
      name: string;
      phone: string | null;
      email: string | null;
      dni: string | null;
      isProfessor: boolean;
    }>,
    users: [
      { id: 77, firstName: 'Ana', lastName: 'Admin', email: 'ana@test.com' },
      { id: 88, firstName: 'Beto', lastName: 'Beta', email: 'beto@test.com' },
      { id: 99, firstName: 'Carla', lastName: 'Cross', email: 'carla@test.com' },
    ],
    memberships: [
      { userId: 77, clubId: 10 },
      { userId: 88, clubId: 10 },
      { userId: 99, clubId: 99 },
    ],
    bookings: [{ id: 101, clubId: 10, clientId: 'c-1' }],
    fixedBookings: [{ id: 201, clubId: 10, clientId: 'c-1' }],
    accounts: [{ id: 'acc-1', clubId: 10, clientId: 'c-1' }],
    clientDiscountAssignments: [{ id: 'as-1', clubId: 10, clientId: 'c-1', policyId: 'pol-1' }],
    accountItemDiscounts: [{ id: 'aid-1', clubId: 10, clientId: 'c-1' }],
    incidents: [
      { id: 'inc-1', clubId: 10, status: 'OPEN', resolvedClientId: null, primaryClientId: 'c-1' },
    ],
    auditLogs: [] as any[],
  };
}

function withMockedPrisma(run: (state: MockState) => Promise<void>) {
  const original = {
    transaction: (prisma as any).$transaction,
    client: (prisma as any).client,
    user: (prisma as any).user,
    membership: (prisma as any).membership,
    booking: (prisma as any).booking,
    fixedBooking: (prisma as any).fixedBooking,
    account: (prisma as any).account,
    clientDiscountAssignment: (prisma as any).clientDiscountAssignment,
    accountItemDiscount: (prisma as any).accountItemDiscount,
    clientDuplicateIncident: (prisma as any).clientDuplicateIncident,
    auditLog: (prisma as any).auditLog,
  };

  const state = buildState();

  const tx: any = {
    client: {
      findUnique: async ({ where }: any) =>
        state.clients.find((row) => String(row.id) === String(where?.id)) || null,
      findFirst: async ({ where, select }: any) => {
        const row = state.clients.find((client) => {
          if (where?.id && String(client.id) !== String(where.id)) return false;
          if (where?.clubId != null && Number(client.clubId) !== Number(where.clubId)) return false;
          if (where?.userId != null && Number(client.userId || 0) !== Number(where.userId)) return false;
          if (where?.NOT?.id && String(client.id) === String(where.NOT.id)) return false;
          return true;
        });
        if (!row) return null;
        if (!select) return row;
        return Object.fromEntries(Object.keys(select).map((key) => [key, (row as any)[key]]));
      },
      update: async ({ where, data }: any) => {
        const index = state.clients.findIndex((row) => String(row.id) === String(where?.id));
        if (index < 0) throw new Error('Client not found');
        state.clients[index] = { ...state.clients[index], ...data };
        return state.clients[index];
      },
    },
    user: {
      findUnique: async ({ where }: any) =>
        state.users.find((row) => Number(row.id) === Number(where?.id)) || null,
    },
    membership: {
      findUnique: async ({ where }: any) =>
        state.memberships.find(
          (row) =>
            Number(row.userId) === Number(where?.userId_clubId?.userId) &&
            Number(row.clubId) === Number(where?.userId_clubId?.clubId)
        ) || null,
    },
    booking: {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        state.bookings = state.bookings.map((row) => {
          if (Number(row.clubId) === Number(where?.clubId) && String(row.clientId) === String(where?.clientId)) {
            count += 1;
            return { ...row, ...data };
          }
          return row;
        });
        return { count };
      },
    },
    fixedBooking: {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        state.fixedBookings = state.fixedBookings.map((row) => {
          if (Number(row.clubId) === Number(where?.clubId) && String(row.clientId) === String(where?.clientId)) {
            count += 1;
            return { ...row, ...data };
          }
          return row;
        });
        return { count };
      },
    },
    account: {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        state.accounts = state.accounts.map((row) => {
          if (Number(row.clubId) === Number(where?.clubId) && String(row.clientId) === String(where?.clientId)) {
            count += 1;
            return { ...row, ...data };
          }
          return row;
        });
        return { count };
      },
    },
    clientDiscountAssignment: {
      findMany: async ({ where, select }: any) => {
        const rows = state.clientDiscountAssignments.filter(
          (row) => Number(row.clubId) === Number(where?.clubId) && String(row.clientId) === String(where?.clientId)
        );
        if (!select) return rows;
        return rows.map((row) => Object.fromEntries(Object.keys(select).map((key) => [key, (row as any)[key]])));
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        state.clientDiscountAssignments = state.clientDiscountAssignments.map((row) => {
          if (Number(row.clubId) === Number(where?.clubId) && String(row.clientId) === String(where?.clientId)) {
            count += 1;
            return { ...row, ...data };
          }
          return row;
        });
        return { count };
      },
    },
    accountItemDiscount: {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        state.accountItemDiscounts = state.accountItemDiscounts.map((row) => {
          if (Number(row.clubId) === Number(where?.clubId) && String(row.clientId) === String(where?.clientId)) {
            count += 1;
            return { ...row, ...data };
          }
          return row;
        });
        return { count };
      },
    },
    clientDuplicateIncident: {
      findFirst: async ({ where, select }: any) => {
        const row = state.incidents.find((incident) => {
          if (where?.id && String(incident.id) !== String(where.id)) return false;
          if (where?.clubId != null && Number(incident.clubId) !== Number(where.clubId)) return false;
          return true;
        });
        if (!row) return null;
        if (!select) return row;
        return Object.fromEntries(Object.keys(select).map((key) => [key, (row as any)[key]]));
      },
      update: async ({ where, data }: any) => {
        const index = state.incidents.findIndex((row) => String(row.id) === String(where?.id));
        if (index < 0) throw new Error('Incident not found');
        state.incidents[index] = { ...state.incidents[index], ...data };
        return state.incidents[index];
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        state.incidents = state.incidents.map((row) => {
          if (where?.clubId != null && Number(row.clubId) !== Number(where.clubId)) return row;
          if (where?.primaryClientId && String(row.primaryClientId) !== String(where.primaryClientId)) {
            if (!where?.resolvedClientId || String(row.resolvedClientId) !== String(where.resolvedClientId)) {
              return row;
            }
          }
          if (where?.resolvedClientId && String(row.resolvedClientId) !== String(where.resolvedClientId)) {
            if (!where?.primaryClientId || String(row.primaryClientId) !== String(where.primaryClientId)) {
              return row;
            }
          }
          count += 1;
          return { ...row, ...data };
        });
        return { count };
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const created = { id: `audit-${state.auditLogs.length + 1}`, ...data };
        state.auditLogs.push(created);
        return created;
      },
    },
  };

  (prisma as any).$transaction = async (fn: any) => fn(tx);

  return run(state).finally(() => {
    (prisma as any).$transaction = original.transaction;
    (prisma as any).client = original.client;
    (prisma as any).user = original.user;
    (prisma as any).membership = original.membership;
    (prisma as any).booking = original.booking;
    (prisma as any).fixedBooking = original.fixedBooking;
    (prisma as any).account = original.account;
    (prisma as any).clientDiscountAssignment = original.clientDiscountAssignment;
    (prisma as any).accountItemDiscount = original.accountItemDiscount;
    (prisma as any).clientDuplicateIncident = original.clientDuplicateIncident;
    (prisma as any).auditLog = original.auditLog;
  });
}

test('link manual OK', async () => {
  const service = new ClientIdentityAdminService();
  await withMockedPrisma(async (state) => {
    const result = await service.linkUserToClient({
      clubId: 10,
      clientId: 'c-1',
      userId: 77,
      actorUserId: 500,
    });
    assert.equal(result?.userId, 77);
    assert.equal(state.clients.find((row) => row.id === 'c-1')?.userId, 77);
    assert.equal(state.auditLogs.some((row) => row.action === 'USER_CLIENT_LINK'), true);
  });
});

test('link manual cross-club bloquea', async () => {
  const service = new ClientIdentityAdminService();
  await withMockedPrisma(async () => {
    await assert.rejects(
      () =>
        service.linkUserToClient({
          clubId: 10,
          clientId: 'c-1',
          userId: 99,
          actorUserId: 500,
        }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.FORBIDDEN
    );
  });
});

test('client ya vinculado a otro usuario bloquea', async () => {
  const service = new ClientIdentityAdminService();
  await withMockedPrisma(async (state) => {
    state.clients[0]!.userId = 88;
    await assert.rejects(
      () =>
        service.linkUserToClient({
          clubId: 10,
          clientId: 'c-1',
          userId: 77,
          actorUserId: 500,
        }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.CLIENT_LINK_CONFLICT
    );
  });
});

test('user inexistente bloquea el link manual', async () => {
  const service = new ClientIdentityAdminService();
  await withMockedPrisma(async () => {
    await assert.rejects(
      () =>
        service.linkUserToClient({
          clubId: 10,
          clientId: 'c-1',
          userId: 999,
          actorUserId: 500,
        }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.USER_NOT_FOUND
    );
  });
});

test('client inexistente bloquea el link manual', async () => {
  const service = new ClientIdentityAdminService();
  await withMockedPrisma(async () => {
    await assert.rejects(
      () =>
        service.linkUserToClient({
          clubId: 10,
          clientId: 'missing-client',
          userId: 77,
          actorUserId: 500,
        }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.CLIENT_NOT_FOUND
    );
  });
});

test('user ya vinculado a otro cliente del club bloquea el link manual', async () => {
  const service = new ClientIdentityAdminService();
  await withMockedPrisma(async (state) => {
    state.clients[1]!.userId = 77;
    await assert.rejects(
      () =>
        service.linkUserToClient({
          clubId: 10,
          clientId: 'c-1',
          userId: 77,
          actorUserId: 500,
        }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.USER_CLIENT_LINK_EXISTS
    );
  });
});

test('unlink manual OK', async () => {
  const service = new ClientIdentityAdminService();
  await withMockedPrisma(async (state) => {
    state.clients[0]!.userId = 77;
    const result = await service.unlinkUserFromClient({
      clubId: 10,
      clientId: 'c-1',
      actorUserId: 500,
    });
    assert.equal(result?.userId, null);
    assert.equal(state.auditLogs.some((row) => row.action === 'USER_CLIENT_UNLINK'), true);
  });
});

test('merge mismo club mueve reservas/cuentas/incidente y deja auditoría', async () => {
  const service = new ClientIdentityAdminService();
  await withMockedPrisma(async (state) => {
    state.clients[0]!.userId = 77;
    const result = await service.mergeClients({
      clubId: 10,
      sourceClientId: 'c-1',
      targetClientId: 'c-2',
      actorUserId: 500,
      incidentId: 'inc-1',
      resolutionNotes: 'Revisado por admin',
    });

    assert.equal(result.moved.bookings, 1);
    assert.equal(result.moved.accounts, 1);
    assert.equal(state.bookings[0]?.clientId, 'c-2');
    assert.equal(state.accounts[0]?.clientId, 'c-2');
    assert.equal(state.incidents[0]?.status, 'RESOLVED');
    assert.equal(state.auditLogs.some((row) => row.action === 'CLIENTS_MERGED'), true);
    assert.equal(state.clients.find((row) => row.id === 'c-2')?.userId, 77);
    assert.equal(state.clients.find((row) => row.id === 'c-1')?.phone, null);
  });
});

test('merge cross-club bloqueado', async () => {
  const service = new ClientIdentityAdminService();
  await withMockedPrisma(async () => {
    await assert.rejects(
      () =>
        service.mergeClients({
          clubId: 10,
          sourceClientId: 'c-1',
          targetClientId: 'c-x',
          actorUserId: 500,
        }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.CLIENT_OUT_OF_CLUB
    );
  });
});

test('no permite merge hacia sí mismo', async () => {
  const service = new ClientIdentityAdminService();
  await withMockedPrisma(async () => {
    await assert.rejects(
      () =>
        service.mergeClients({
          clubId: 10,
          sourceClientId: 'c-1',
          targetClientId: 'c-1',
          actorUserId: 500,
        }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.CLIENT_MERGE_SAME_CLIENT
    );
  });
});

test('merge con descuentos incompatibles bloquea', async () => {
  const service = new ClientIdentityAdminService();
  await withMockedPrisma(async (state) => {
    state.clientDiscountAssignments.push({
      id: 'as-2',
      clubId: 10,
      clientId: 'c-2',
      policyId: 'pol-1',
    });
    await assert.rejects(
      () =>
        service.mergeClients({
          clubId: 10,
          sourceClientId: 'c-1',
          targetClientId: 'c-2',
          actorUserId: 500,
        }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.CLIENT_MERGE_CONFLICT
    );
  });
});

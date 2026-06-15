import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { ClientIdentityOverviewService } from '../src/services/ClientIdentityOverviewService';

type State = ReturnType<typeof buildState>;

function buildState() {
  return {
    client: {
      id: 'c-1',
      clubId: 10,
      userId: null,
      name: 'Ana Cliente',
      email: 'ana@test.com',
      phone: '+5493511111111',
      dni: '30111222',
      user: null
    },
    users: [
      { id: 77, firstName: 'Ana', lastName: 'Admin', email: 'ana@test.com', phoneNumber: '+5493511111111', dni: '30111222' }
    ],
    clients: [
      { id: 'c-1', clubId: 10, userId: null, name: 'Ana Cliente', email: 'ana@test.com', phone: '+5493511111111', dni: '30111222', user: null },
    ]
  };
}

function withMockedPrisma(run: (state: State) => Promise<void>) {
  const originalClientFindUnique = (prisma as any).client.findUnique;
  const originalClientFindMany = (prisma as any).client.findMany;
  const originalUserFindMany = (prisma as any).user.findMany;
  const originalIncidentFindMany = (prisma as any).clientDuplicateIncident?.findMany;
  const state = buildState();

  (prisma as any).client.findUnique = async ({ where }: any) => {
    if (String(where?.id) === String(state.client.id)) return state.client;
    return null;
  };
  (prisma as any).user.findMany = async ({ where }: any) => {
    const conditions = Array.isArray(where?.OR) ? where.OR : [];
    return state.users.filter((user) =>
      conditions.some((condition: any) => {
        if (condition?.email) return String(user.email || '') === String(condition.email);
        if (condition?.dni) return String(user.dni || '') === String(condition.dni);
        if (condition?.phoneNumber?.in) return (condition.phoneNumber.in as string[]).includes(String(user.phoneNumber || ''));
        return false;
      })
    );
  };
  (prisma as any).client.findMany = async ({ where }: any) => {
    if (where?.userId?.in) {
      return state.clients.filter((client) => where.userId.in.includes(Number(client.userId || 0)));
    }
    if (where?.userId === null && Number(where?.clubId) > 0) {
      return state.clients.filter((client) => Number(client.clubId) === Number(where.clubId) && client.userId == null);
    }
    const conditions = Array.isArray(where?.OR) ? where.OR : [];
    return state.clients.filter((client) => {
      if (String(client.id) === String(where?.NOT?.id)) return false;
      if (Number(client.clubId) !== Number(where?.clubId)) return false;
      return conditions.some((condition: any) => {
        if (condition?.email) return String(client.email || '') === String(condition.email);
        if (condition?.dni) return String(client.dni || '') === String(condition.dni);
        if (condition?.phone?.in) return (condition.phone.in as string[]).includes(String(client.phone || ''));
        return false;
      });
    });
  };
  (prisma as any).clientDuplicateIncident = {
    findMany: async () => []
  };

  return run(state).finally(() => {
    (prisma as any).client.findUnique = originalClientFindUnique;
    (prisma as any).client.findMany = originalClientFindMany;
    (prisma as any).user.findMany = originalUserFindMany;
    if (originalIncidentFindMany) {
      (prisma as any).clientDuplicateIncident = { ...(prisma as any).clientDuplicateIncident, findMany: originalIncidentFindMany };
    }
  });
}

test('getOverview devuelve suggested link cuando hay un unico usuario compatible', async () => {
  await withMockedPrisma(async () => {
    const service = new ClientIdentityOverviewService();
    const overview = await service.getOverview(10, 'c-1');
    assert.equal(overview.status, 'SUGGESTED_LINK');
    assert.equal(overview.reasonCode, 'SINGLE_USER_CANDIDATE');
    assert.equal(overview.recommendedUserId, 77);
    assert.equal(overview.userCandidates.length, 1);
    assert.deepEqual(overview.userCandidates[0]?.matchedBy, ['EMAIL', 'PHONE', 'DNI']);
  });
});

test('getOverview devuelve review required cuando hay cliente duplicado', async () => {
  await withMockedPrisma(async (state) => {
    state.clients.push({
      id: 'c-2',
      clubId: 10,
      userId: null,
      name: 'Ana Duplicada',
      email: 'ana@test.com',
      phone: '+5493511111111',
      dni: '30111222',
      user: null
    });
    const service = new ClientIdentityOverviewService();
    const overview = await service.getOverview(10, 'c-1');
    assert.equal(overview.status, 'REVIEW_REQUIRED');
    assert.equal(overview.reasonCode, 'DUPLICATE_CLIENT_AND_USER_CONFLICT');
    assert.equal(overview.duplicateClients.length, 1);
  });
});

test('listQueue devuelve solo clientes con suggested link o review required', async () => {
  await withMockedPrisma(async (state) => {
    state.clients.push({
      id: 'c-2',
      clubId: 10,
      userId: null,
      name: 'Ana Duplicada',
      email: 'ana@test.com',
      phone: '+5493511111111',
      dni: '30111222',
      user: null
    });
    state.clients.push({
      id: 'c-3',
      clubId: 10,
      userId: null,
      name: 'Sin Match',
      email: 'sin@match.com',
      phone: null,
      dni: null,
      user: null
    } as any);
    const service = new ClientIdentityOverviewService();
    const queue = await service.listQueue(10);
    assert.equal(queue.length, 2);
    assert.equal(queue[0]?.status, 'REVIEW_REQUIRED');
    assert.equal(queue[0]?.clientId, 'c-1');
    assert.equal(queue[1]?.clientId, 'c-2');
    assert.equal(queue[1]?.status, 'REVIEW_REQUIRED');
  });
});

test('listQueue incluye casos marcados manualmente para revisión aunque no surjan del cómputo', async () => {
  await withMockedPrisma(async () => {
    (prisma as any).clientDuplicateIncident.findMany = async () => ([
      {
        id: 'inc-1',
        clubId: 10,
        status: 'OPEN',
        sourceType: 'ADMIN',
        primaryClientId: 'c-9',
        candidateClientIds: ['c-9'],
        createdAt: new Date('2026-06-07T10:00:00.000Z'),
        payload: {
          kind: 'IDENTITY_REVIEW',
          clientId: 'c-9',
          clientName: 'Caso Manual',
          status: 'REVIEW_REQUIRED',
          reasonCode: 'NO_STRONG_MATCH',
          summary: 'Marcado manualmente por staff.',
          signals: [],
          userCandidates: [],
          duplicateClients: [],
          note: 'Revisar luego'
        }
      }
    ]);

    const service = new ClientIdentityOverviewService();
    const queue = await service.listQueue(10);
    assert.equal(queue.some((row) => row.clientId === 'c-9' && row.isManualReview === true), true);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientDuplicateIncidentService } from '../src/services/ClientDuplicateIncidentService';
import { prisma } from '../src/prisma';

function withMockedPrisma(run: (state: { incidents: any[]; clients: any[]; auditLogs: any[] }) => Promise<void>) {
  const original = {
    transaction: (prisma as any).$transaction,
    incident: (prisma as any).clientDuplicateIncident,
    client: (prisma as any).client,
    auditLog: (prisma as any).auditLog
  };

  const incidents: any[] = [];
  const clients: any[] = [
    { id: 'c-1', clubId: 10, userId: null, name: 'Cliente 1', phone: '+5493511111111', email: 'c1@example.com', dni: '30111222', isProfessor: false },
    { id: 'c-2', clubId: 10, userId: null, name: 'Cliente 2', phone: '+5493512222222', email: 'c2@example.com', dni: '30222333', isProfessor: false }
  ];
  const auditLogs: any[] = [];

  const incidentRepo = {
    findFirst: async ({ where }: any) =>
      incidents.find((item) => {
        if (where?.id && String(item.id) !== String(where.id)) return false;
        if (where?.clubId != null && Number(item.clubId) !== Number(where.clubId)) return false;
        if (where?.status && String(item.status) !== String(where.status)) return false;
        if (where?.dedupeKey && String(item.dedupeKey) !== String(where.dedupeKey)) return false;
        return true;
      }) || null,
    findMany: async ({ where }: any) =>
      incidents.filter((item) => {
        if (where?.clubId != null && Number(item.clubId) !== Number(where.clubId)) return false;
        if (where?.status && String(item.status) !== String(where.status)) return false;
        if (where?.sourceType && String(item.sourceType) !== String(where.sourceType)) return false;
        return true;
      }),
    create: async ({ data }: any) => {
      const created = {
        id: `inc-${incidents.length + 1}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      incidents.push(created);
      return created;
    },
    update: async ({ where, data }: any) => {
      const idx = incidents.findIndex((item) => String(item.id) === String(where.id));
      if (idx < 0) throw new Error('Incident not found');
      incidents[idx] = { ...incidents[idx], ...data, updatedAt: new Date() };
      return incidents[idx];
    }
  };

  const clientRepo = {
    findMany: async ({ where }: any) => clients.filter((item) => Number(item.clubId) === Number(where?.clubId)),
    findFirst: async ({ where }: any) =>
      clients.find((item) => String(item.id) === String(where?.id) && Number(item.clubId) === Number(where?.clubId)) || null,
    update: async ({ where, data }: any) => {
      const idx = clients.findIndex((item) => String(item.id) === String(where?.id));
      if (idx < 0) throw new Error('Client not found');
      clients[idx] = { ...clients[idx], ...data };
      return clients[idx];
    }
  };

  (prisma as any).clientDuplicateIncident = incidentRepo;
  (prisma as any).client = clientRepo;
  (prisma as any).auditLog = {
    create: async ({ data }: any) => {
      const created = { id: `audit-${auditLogs.length + 1}`, ...data, createdAt: new Date() };
      auditLogs.push(created);
      return created;
    }
  };
  (prisma as any).$transaction = async (fn: any) => fn({
    clientDuplicateIncident: incidentRepo,
    client: clientRepo,
    auditLog: (prisma as any).auditLog
  });

  return run({ incidents, clients, auditLogs }).finally(() => {
    (prisma as any).$transaction = original.transaction;
    (prisma as any).clientDuplicateIncident = original.incident;
    (prisma as any).client = original.client;
    (prisma as any).auditLog = original.auditLog;
  });
}

test('createOrReuseIncident no duplica incidentes abiertos iguales', async () => {
  const service = new ClientDuplicateIncidentService();

  await withMockedPrisma(async ({ incidents }) => {
    const first = await service.createOrReuseIncident({
      clubId: 10,
      userId: 7,
      sourceType: 'BOOKING',
      reasonType: 'PHONE',
      candidateClientIds: ['c-1', 'c-2'],
      payload: { source: 'test-a' }
    });
    const second = await service.createOrReuseIncident({
      clubId: 10,
      userId: 7,
      sourceType: 'BOOKING',
      reasonType: 'PHONE',
      candidateClientIds: ['c-2', 'c-1'],
      payload: { source: 'test-b' }
    });

    assert.equal(incidents.length, 1);
    assert.equal(first.id, second.id);
  });
});

test('resolveByLinkingUser vincula user al client y marca RESOLVED', async () => {
  const service = new ClientDuplicateIncidentService();

  await withMockedPrisma(async ({ incidents, clients, auditLogs }) => {
    incidents.push({
      id: 'inc-1',
      clubId: 10,
      userId: 77,
      status: 'OPEN',
      sourceType: 'FAVORITE',
      reasonType: 'MULTI_SIGNAL_CONFLICT',
      candidateClientIds: ['c-1', 'c-2'],
      dedupeKey: 'k-1',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const resolved = await service.resolveByLinkingUser({
      clubId: 10,
      incidentId: 'inc-1',
      clientId: 'c-2',
      actorUserId: 999
    });

    assert.equal(resolved.status, 'RESOLVED');
    assert.equal(resolved.resolvedClientId, 'c-2');
    assert.equal(clients.find((item) => item.id === 'c-2')?.userId, 77);
    assert.equal(auditLogs.some((row) => row.payload?.reason === 'MANUAL_ADMIN_LINK'), true);
  });
});

test('dismissIncident marca DISMISSED sin mergear clientes', async () => {
  const service = new ClientDuplicateIncidentService();

  await withMockedPrisma(async ({ incidents, clients }) => {
    incidents.push({
      id: 'inc-1',
      clubId: 10,
      userId: null,
      status: 'OPEN',
      sourceType: 'CASH',
      reasonType: 'PHONE',
      candidateClientIds: ['c-1', 'c-2'],
      dedupeKey: 'k-2',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const beforeUsers = clients.map((item) => item.userId);
    const dismissed = await service.dismissIncident({
      clubId: 10,
      incidentId: 'inc-1',
      actorUserId: 999,
      resolutionNotes: 'Revisado'
    });

    assert.equal(dismissed.status, 'DISMISSED');
    assert.deepEqual(clients.map((item) => item.userId), beforeUsers);
  });
});

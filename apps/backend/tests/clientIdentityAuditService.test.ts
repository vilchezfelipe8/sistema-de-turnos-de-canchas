import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { ClientIdentityAuditService } from '../src/services/ClientIdentityAuditService';

test('listTimeline devuelve eventos directos y de fusión para un cliente', async () => {
  const originalClientFindUnique = (prisma as any).client.findUnique;
  const originalAuditFindMany = (prisma as any).auditLog.findMany;

  (prisma as any).client.findUnique = async () => ({
    id: 'c-1',
    clubId: 10,
    name: 'Lionel Messi',
  });

  (prisma as any).auditLog.findMany = async ({ where }: any) => {
    if (where?.entityId === 'c-1') {
      return [
        {
          id: 'log-1',
          entityId: 'c-1',
          action: 'USER_CLIENT_LINK',
          createdAt: new Date('2026-06-07T10:00:00.000Z'),
          payload: { linkedUserId: 88, reason: 'MANUAL_ADMIN_LINK' },
          user: { id: 7, firstName: 'Ada', lastName: 'Admin', email: 'ada@test.com' },
        },
      ];
    }
    return [
      {
        id: 'log-2',
        entityId: 'c-2',
        action: 'CLIENTS_MERGED',
        createdAt: new Date('2026-06-07T11:00:00.000Z'),
        payload: { sourceClientId: 'c-1', targetClientId: 'c-2' },
        user: { id: 9, firstName: 'Mora', lastName: 'Staff', email: 'mora@test.com' },
      },
    ];
  };

  try {
    const service = new ClientIdentityAuditService();
    const timeline = await service.listTimeline(10, 'c-1', 10);
    assert.equal(timeline.length, 2);
    assert.equal(timeline[0]?.action, 'CLIENTS_MERGED');
    assert.match(String(timeline[0]?.summary || ''), /fusion/i);
    assert.equal(timeline[1]?.action, 'USER_CLIENT_LINK');
    assert.match(String(timeline[1]?.summary || ''), /vinculó/i);
  } finally {
    (prisma as any).client.findUnique = originalClientFindUnique;
    (prisma as any).auditLog.findMany = originalAuditFindMany;
  }
});

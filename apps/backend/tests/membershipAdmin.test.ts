import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { MembershipAdminService } from '../src/services/MembershipAdminService';
import { AppError, ErrorCodes } from '../src/errors';

type MockState = ReturnType<typeof buildState>;

function buildState() {
  return {
    users: [
      { id: 1, email: 'owner@test.com', firstName: 'Olga', lastName: 'Owner' },
      { id: 2, email: 'admin@test.com', firstName: 'Ada', lastName: 'Admin' },
      { id: 3, email: 'staff@test.com', firstName: 'Santi', lastName: 'Staff' },
      { id: 4, email: 'nuevo@test.com', firstName: 'Nora', lastName: 'New' },
      { id: 5, email: 'otherclub@test.com', firstName: 'Otto', lastName: 'Other' }
    ],
    memberships: [
      { id: 'm-owner', userId: 1, clubId: 10, role: 'OWNER', createdAt: new Date('2026-05-01T10:00:00Z') },
      { id: 'm-admin', userId: 2, clubId: 10, role: 'ADMIN', createdAt: new Date('2026-05-02T10:00:00Z') },
      { id: 'm-staff', userId: 3, clubId: 10, role: 'STAFF', createdAt: new Date('2026-05-03T10:00:00Z') },
      { id: 'm-owner-other', userId: 5, clubId: 99, role: 'OWNER', createdAt: new Date('2026-05-04T10:00:00Z') }
    ] as Array<any>,
    auditLogs: [] as any[]
  };
}

function withMockedPrisma(run: (state: MockState) => Promise<void>) {
  const original = {
    transaction: (prisma as any).$transaction,
    user: (prisma as any).user,
    membership: (prisma as any).membership,
    auditLog: (prisma as any).auditLog
  };

  const state = buildState();

  const includeUser = (membership: any) => ({
    ...membership,
    user: state.users.find((row) => Number(row.id) === Number(membership.userId)) || null
  });

  const tx: any = {
    user: {
      findUnique: async ({ where }: any) => {
        if (where?.email) {
          return state.users.find((row) => String(row.email) === String(where.email)) || null;
        }
        if (where?.id != null) {
          return state.users.find((row) => Number(row.id) === Number(where.id)) || null;
        }
        return null;
      }
    },
    membership: {
      findUnique: async ({ where, include, select }: any) => {
        let row = null;
        if (where?.userId_clubId) {
          row =
            state.memberships.find(
              (item) =>
                Number(item.userId) === Number(where.userId_clubId.userId) &&
                Number(item.clubId) === Number(where.userId_clubId.clubId)
            ) || null;
        } else if (where?.id) {
          row = state.memberships.find((item) => String(item.id) === String(where.id)) || null;
        }
        if (!row) return null;
        if (include?.user) return includeUser(row);
        if (select) {
          return Object.fromEntries(Object.keys(select).map((key) => [key, (row as any)[key]]));
        }
        return row;
      },
      findMany: async ({ where, include }: any) => {
        const rows = state.memberships
          .filter((item) => Number(item.clubId) === Number(where?.clubId))
          .filter((item) => !where?.role?.in || where.role.in.includes(item.role))
          .sort((left, right) => Number(left.createdAt) - Number(right.createdAt));
        return include?.user ? rows.map(includeUser) : rows;
      },
      count: async ({ where }: any) =>
        state.memberships.filter(
          (item) => Number(item.clubId) === Number(where?.clubId) && String(item.role) === String(where?.role)
        ).length,
      create: async ({ data, include }: any) => {
        const created = {
          id: `m-${state.memberships.length + 1}`,
          createdAt: new Date('2026-05-10T10:00:00Z'),
          ...data
        };
        state.memberships.push(created);
        return include?.user ? includeUser(created) : created;
      },
      update: async ({ where, data, include }: any) => {
        const index = state.memberships.findIndex((item) => String(item.id) === String(where?.id));
        if (index < 0) throw new Error('Membership not found');
        state.memberships[index] = { ...state.memberships[index], ...data };
        return include?.user ? includeUser(state.memberships[index]) : state.memberships[index];
      },
      delete: async ({ where }: any) => {
        const index = state.memberships.findIndex((item) => String(item.id) === String(where?.id));
        if (index < 0) throw new Error('Membership not found');
        const [removed] = state.memberships.splice(index, 1);
        return removed;
      }
    },
    auditLog: {
      create: async ({ data }: any) => {
        const row = { id: `audit-${state.auditLogs.length + 1}`, ...data };
        state.auditLogs.push(row);
        return row;
      }
    }
  };

  (prisma as any).$transaction = async (fn: any) => fn(tx);
  (prisma as any).auditLog = tx.auditLog;

  return run(state).finally(() => {
    (prisma as any).$transaction = original.transaction;
    (prisma as any).user = original.user;
    (prisma as any).membership = original.membership;
    (prisma as any).auditLog = original.auditLog;
  });
}

test('lista miembros como owner/admin y no incluye customers', async () => {
  await withMockedPrisma(async () => {
    const service = new MembershipAdminService();
    const items = await service.listMembers({ clubId: 10, actorUserId: 1 });
    assert.equal(items.length, 3);
    assert.deepEqual(items.map((item) => item.role), ['OWNER', 'ADMIN', 'STAFF']);
  });
});

test('staff no puede gestionar miembros', async () => {
  await withMockedPrisma(async () => {
    const service = new MembershipAdminService();
    await assert.rejects(
      service.listMembers({ clubId: 10, actorUserId: 3 }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.MEMBERSHIP_FORBIDDEN
    );
  });
});

test('invita usuario existente y audita', async () => {
  await withMockedPrisma(async (state) => {
    const service = new MembershipAdminService();
    const created = await service.inviteMember({
      clubId: 10,
      actorUserId: 1,
      email: 'nuevo@test.com',
      role: 'STAFF'
    });
    assert.equal(created.user?.email, 'nuevo@test.com');
    assert.equal(created.role, 'STAFF');
    assert.equal(state.memberships.length, 5);
    assert.equal(state.auditLogs[state.auditLogs.length - 1]?.action, 'MEMBERSHIP_INVITED');
  });
});

test('invitar email inválido devuelve fieldErrors', async () => {
  await withMockedPrisma(async () => {
    const service = new MembershipAdminService();
    await assert.rejects(
      service.inviteMember({
        clubId: 10,
        actorUserId: 1,
        email: ' ',
        role: 'STAFF'
      }),
      (error: any) =>
        error instanceof AppError &&
        error.code === ErrorCodes.VALIDATION_ERROR &&
        Boolean(error.fieldErrors?.email)
    );
  });
});

test('bloquea membresía duplicada', async () => {
  await withMockedPrisma(async () => {
    const service = new MembershipAdminService();
    await assert.rejects(
      service.inviteMember({
        clubId: 10,
        actorUserId: 1,
        email: 'staff@test.com',
        role: 'STAFF'
      }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.MEMBERSHIP_ALREADY_EXISTS
    );
  });
});

test('invitar usuario inexistente bloquea con fieldErrors', async () => {
  await withMockedPrisma(async () => {
    const service = new MembershipAdminService();
    await assert.rejects(
      service.inviteMember({
        clubId: 10,
        actorUserId: 1,
        email: 'no-existe@test.com',
        role: 'STAFF'
      }),
      (error: any) =>
        error instanceof AppError &&
        error.code === ErrorCodes.USER_NOT_FOUND &&
        Boolean(error.fieldErrors?.email)
    );
  });
});

test('bloquea rol de membresía no gestionable', async () => {
  await withMockedPrisma(async () => {
    const service = new MembershipAdminService();
    await assert.rejects(
      service.inviteMember({
        clubId: 10,
        actorUserId: 1,
        email: 'nuevo@test.com',
        role: 'CUSTOMER'
      }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.MEMBERSHIP_ROLE_INVALID
    );
  });
});

test('admin puede cambiar rol de staff pero no promover admin', async () => {
  await withMockedPrisma(async (state) => {
    const service = new MembershipAdminService();
    const updated = await service.updateMemberRole({
      clubId: 10,
      actorUserId: 2,
      membershipId: 'm-staff',
      role: 'STAFF'
    });
    assert.equal(updated.role, 'STAFF');

    await assert.rejects(
      service.updateMemberRole({
        clubId: 10,
        actorUserId: 2,
        membershipId: 'm-staff',
        role: 'ADMIN'
      }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.MEMBERSHIP_FORBIDDEN
    );

    assert.equal(state.auditLogs.length, 0);
  });
});

test('bloquea degradar último owner', async () => {
  await withMockedPrisma(async () => {
    const service = new MembershipAdminService();
    await assert.rejects(
      service.updateMemberRole({
        clubId: 10,
        actorUserId: 1,
        membershipId: 'm-owner',
        role: 'ADMIN'
      }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.MEMBERSHIP_LAST_OWNER
    );
  });
});

test('quita acceso y bloquea quitar último owner', async () => {
  await withMockedPrisma(async (state) => {
    const service = new MembershipAdminService();
    const removed = await service.removeMember({
      clubId: 10,
      actorUserId: 1,
      membershipId: 'm-staff'
    });
    assert.equal(removed.success, true);
    assert.equal(state.memberships.some((item) => item.id === 'm-staff'), false);
    assert.equal(state.auditLogs[state.auditLogs.length - 1]?.action, 'MEMBERSHIP_REMOVED');

    await assert.rejects(
      service.removeMember({
        clubId: 10,
        actorUserId: 1,
        membershipId: 'm-owner'
      }),
      (error: any) => error instanceof AppError && error.code === ErrorCodes.MEMBERSHIP_LAST_OWNER
    );
  });
});

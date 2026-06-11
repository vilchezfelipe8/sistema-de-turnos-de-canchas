import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { UserClubProfileService } from '../src/services/UserClubProfileService';
import { PersonService } from '../src/services/PersonService';

type State = ReturnType<typeof buildState>;

function buildState() {
  return {
    user: {
      id: 77,
      email: 'ana@test.com',
      phoneNumber: '+5493511111111',
      dni: '30111222'
    },
    memberships: [
      {
        clubId: 10,
        role: 'CUSTOMER',
        club: { id: 10, name: 'Club Uno', slug: 'club-uno' }
      },
      {
        clubId: 20,
        role: 'CUSTOMER',
        club: { id: 20, name: 'Club Dos', slug: 'club-dos' }
      }
    ],
    clients: [
      {
        id: 'c-linked',
        clubId: 10,
        userId: 77,
        email: 'ana@test.com',
        phone: '+5493511111111',
        dni: '30111222',
        club: { id: 10, name: 'Club Uno', slug: 'club-uno' }
      },
      {
        id: 'c-claim',
        clubId: 20,
        userId: null,
        email: 'ana@test.com',
        phone: '+5493511111111',
        dni: null,
        club: { id: 20, name: 'Club Dos', slug: 'club-dos' }
      },
      {
        id: 'c-conflict-a',
        clubId: 30,
        userId: null,
        email: 'ana@test.com',
        phone: '+5493511111111',
        dni: null,
        club: { id: 30, name: 'Club Tres', slug: 'club-tres' }
      },
      {
        id: 'c-conflict-b',
        clubId: 30,
        userId: null,
        email: 'ana@test.com',
        phone: '+5493511111111',
        dni: null,
        club: { id: 30, name: 'Club Tres', slug: 'club-tres' }
      }
    ]
  };
}

function withMockedPrisma(run: (state: State) => Promise<void>) {
  const originalUserFindUnique = (prisma as any).user.findUnique;
  const originalMembershipFindMany = (prisma as any).membership.findMany;
  const originalClientFindMany = (prisma as any).client.findMany;

  const state = buildState();

  (prisma as any).user.findUnique = async ({ where }: any) => {
    if (Number(where?.id) === Number(state.user.id)) return state.user;
    return null;
  };
  (prisma as any).membership.findMany = async ({ where }: any) => {
    if (Number(where?.userId) !== Number(state.user.id)) return [];
    return state.memberships;
  };
  (prisma as any).client.findMany = async ({ where }: any) => {
    if (where?.userId != null) {
      return state.clients.filter((client) => Number(client.userId || 0) === Number(where.userId));
    }
    return state.clients.filter((client) => {
      const conditions = Array.isArray(where?.OR) ? where.OR : [];
      return conditions.some((condition: any) => {
        if (condition?.email) return String(client.email || '') === String(condition.email);
        if (condition?.dni) return String(client.dni || '') === String(condition.dni);
        if (condition?.phone?.in) return (condition.phone.in as string[]).includes(String(client.phone || ''));
        return false;
      });
    });
  };

  return run(state).finally(() => {
    (prisma as any).user.findUnique = originalUserFindUnique;
    (prisma as any).membership.findMany = originalMembershipFindMany;
    (prisma as any).client.findMany = originalClientFindMany;
  });
}

test('listUserClubProfiles clasifica linked, claimable y conflicted', async () => {
  await withMockedPrisma(async () => {
    const service = new UserClubProfileService();
    const profiles = await service.listUserClubProfiles(77);

    assert.equal(profiles[0]?.status, 'LINKED');
    assert.equal(profiles[0]?.clubId, 10);
    assert.equal(profiles[0]?.reasonCode, 'ALREADY_LINKED');

    const claimable = profiles.find((profile) => profile.clubId === 20);
    assert.equal(claimable?.status, 'CLAIMABLE');
    assert.equal(claimable?.canClaim, true);
    assert.equal(claimable?.reasonCode, 'UNIQUE_STRONG_MATCH');
    assert.deepEqual(claimable?.matchedBy, ['EMAIL', 'PHONE']);

    const conflicted = profiles.find((profile) => profile.clubId === 30);
    assert.equal(conflicted?.status, 'CONFLICTED');
    assert.equal(conflicted?.candidateClientIds.length, 2);
    assert.equal(conflicted?.reasonCode, 'MULTIPLE_STRONG_MATCHES');
    assert.equal(conflicted?.conflictDetails?.freeCandidateCount, 2);
  });
});

test('claimClubProfile delega en ensureClientForUser cuando el perfil es claimable', async () => {
  await withMockedPrisma(async () => {
    const service = new UserClubProfileService();
    const originalEnsure = PersonService.prototype.ensureClientForUser;
    let calledWith: any = null;

    PersonService.prototype.ensureClientForUser = async (clubId: number, userId: number, options?: any): Promise<any> => {
      calledWith = { clubId, userId, options };
      return { id: 'c-claim', clubId, userId };
    };

    try {
      await service.claimClubProfile(77, 20);
      assert.deepEqual(calledWith, {
        clubId: 20,
        userId: 77,
        options: {
          actorUserId: 77,
          source: 'SELF_CLAIM'
        }
      });
    } finally {
      PersonService.prototype.ensureClientForUser = originalEnsure;
    }
  });
});

import { MembershipRole, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { normalizeEmail } from '../utils/magicLink';
import { getPhoneIdentityVariants, normalizeIdentityPhone } from '../utils/phone';
import { conflict, notFound } from '../errors';
import { ErrorCodes } from '../errors/errorCodes';
import { PersonService } from './PersonService';

export type ClubProfileStatus = 'LINKED' | 'CLAIMABLE' | 'CONFLICTED' | 'AVAILABLE';
export type ClubProfileReasonCode =
  | 'ALREADY_LINKED'
  | 'UNIQUE_STRONG_MATCH'
  | 'MULTIPLE_STRONG_MATCHES'
  | 'MATCH_LINKED_TO_ANOTHER_USER'
  | 'MIXED_STRONG_MATCH_CONFLICT'
  | 'NO_STRONG_MATCH';
export type ClubProfileMatchSignal = 'EMAIL' | 'PHONE' | 'DNI';

export type ClubProfileSummary = {
  clubId: number;
  clubName: string;
  clubSlug: string;
  membershipRole: MembershipRole | null;
  status: ClubProfileStatus;
  linkedClientId: string | null;
  candidateClientIds: string[];
  reason: string;
  reasonCode: ClubProfileReasonCode;
  matchedBy: ClubProfileMatchSignal[];
  conflictDetails: {
    candidateCount: number;
    freeCandidateCount: number;
    linkedToAnotherUserCount: number;
  } | null;
  canClaim: boolean;
};

type UserIdentity = {
  id: number;
  email: string | null;
  phoneNumber: string | null;
  dni: string | null;
};

type MembershipRow = {
  clubId: number;
  role: MembershipRole;
  club: {
    id: number;
    name: string;
    slug: string;
  };
};

type MatchingClientRow = {
  id: string;
  clubId: number;
  userId: number | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  dni: string | null;
  club: {
    id: number;
    name: string;
    slug: string;
  };
};

const STATUS_PRIORITY: Record<ClubProfileStatus, number> = {
  LINKED: 0,
  CLAIMABLE: 1,
  CONFLICTED: 2,
  AVAILABLE: 3
};

export class UserClubProfileService {
  private readonly personService = new PersonService();

  async listUserClubProfiles(userId: number): Promise<ClubProfileSummary[]> {
    const safeUserId = Number(userId || 0);
    if (!Number.isInteger(safeUserId) || safeUserId <= 0) {
      return [];
    }

    const user = await prisma.user.findUnique({
      where: { id: safeUserId },
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        dni: true
      }
    });
    if (!user) {
      throw notFound('Usuario no encontrado', ErrorCodes.USER_NOT_FOUND);
    }

    const [memberships, linkedClients, matchingClients] = await Promise.all([
      prisma.membership.findMany({
        where: { userId: safeUserId },
        select: {
          clubId: true,
          role: true,
          club: {
            select: {
              id: true,
              name: true,
              slug: true
            }
          }
        }
      }) as Promise<MembershipRow[]>,
      prisma.client.findMany({
        where: { userId: safeUserId },
        select: {
          id: true,
          clubId: true,
          userId: true,
          club: {
            select: {
              id: true,
              name: true,
              slug: true
            }
          }
        }
      }) as Promise<MatchingClientRow[]>,
      this.findMatchingClientsForUser(user)
    ]);

    const groups = new Map<number, {
      clubId: number;
      clubName: string;
      clubSlug: string;
      membershipRole: MembershipRole | null;
      clients: MatchingClientRow[];
    }>();

    const ensureGroup = (clubId: number, clubName: string, clubSlug: string, membershipRole: MembershipRole | null) => {
      const existing = groups.get(clubId);
      if (existing) {
        if (!existing.membershipRole && membershipRole) {
          existing.membershipRole = membershipRole;
        }
        return existing;
      }
      const created = {
        clubId,
        clubName,
        clubSlug,
        membershipRole,
        clients: [] as MatchingClientRow[]
      };
      groups.set(clubId, created);
      return created;
    };

    for (const membership of memberships) {
      ensureGroup(Number(membership.clubId), String(membership.club.name || ''), String(membership.club.slug || ''), membership.role);
    }

    for (const client of [...linkedClients, ...matchingClients]) {
      const group = ensureGroup(
        Number(client.clubId),
        String(client.club?.name || ''),
        String(client.club?.slug || ''),
        groups.get(Number(client.clubId))?.membershipRole || null
      );
      if (!group.clients.some((row) => String(row.id) === String(client.id))) {
        group.clients.push(client);
      }
    }

    return Array.from(groups.values())
      .map((group) => this.buildSummaryForGroup(group, safeUserId, user))
      .sort((left, right) => {
        const leftPriority = STATUS_PRIORITY[left.status] ?? 99;
        const rightPriority = STATUS_PRIORITY[right.status] ?? 99;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return left.clubName.localeCompare(right.clubName, 'es');
      });
  }

  async claimClubProfile(userId: number, clubId: number) {
    const safeUserId = Number(userId || 0);
    const safeClubId = Number(clubId || 0);
    if (!Number.isInteger(safeUserId) || safeUserId <= 0) {
      throw notFound('Usuario no encontrado', ErrorCodes.USER_NOT_FOUND);
    }

    const profiles = await this.listUserClubProfiles(safeUserId);
    const target = profiles.find((profile) => Number(profile.clubId) === safeClubId) || null;
    if (!target) {
      throw notFound('No encontramos un perfil reclamable en este club.', ErrorCodes.CLIENT_NOT_FOUND);
    }

    if (target.status === 'LINKED') {
      return target;
    }

    if (target.status !== 'CLAIMABLE') {
      throw conflict(
        'No pudimos vincularte automáticamente en este club. Necesitamos revisar el caso antes de continuar.',
        ErrorCodes.CLIENT_POSSIBLE_DUPLICATE,
        {
          clubId: safeClubId,
          status: target.status,
          candidateClientIds: target.candidateClientIds,
          reasonCode: target.reasonCode,
          conflictDetails: target.conflictDetails,
          matchedBy: target.matchedBy
        }
      );
    }

    await this.personService.ensureClientForUser(safeClubId, safeUserId, {
      actorUserId: safeUserId,
      source: 'SELF_CLAIM'
    });

    const refreshed = await this.listUserClubProfiles(safeUserId);
    return (
      refreshed.find((profile) => Number(profile.clubId) === safeClubId) || {
        ...target,
        status: 'LINKED' as const,
        linkedClientId: target.candidateClientIds[0] || null,
        reasonCode: 'ALREADY_LINKED' as const,
        canClaim: false,
        reason: 'Perfil vinculado a tu cuenta'
      }
    );
  }

  private async findMatchingClientsForUser(user: UserIdentity): Promise<MatchingClientRow[]> {
    const where = this.buildStrongIdentityWhere(user);
    if (!where) return [];

    return prisma.client.findMany({
      where,
      select: {
        id: true,
        clubId: true,
        userId: true,
        name: true,
        email: true,
        phone: true,
        dni: true,
        club: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    }) as Promise<MatchingClientRow[]>;
  }

  private buildStrongIdentityWhere(user: UserIdentity): Prisma.ClientWhereInput | null {
    const normalizedEmail = normalizeEmail(String(user.email || ''));
    const normalizedPhone = normalizeIdentityPhone(user.phoneNumber);
    const normalizedDni = String(user.dni || '').replace(/\D/g, '').trim();
    const phoneVariants = normalizedPhone ? getPhoneIdentityVariants(normalizedPhone) : [];
    const or: Prisma.ClientWhereInput[] = [];

    if (normalizedEmail) {
      or.push({ email: normalizedEmail });
    }
    if (phoneVariants.length > 0) {
      or.push({ phone: { in: phoneVariants } });
    }
    if (normalizedDni.length >= 6) {
      or.push({ dni: normalizedDni });
    }

    return or.length > 0 ? { OR: or } : null;
  }

  private getMatchSignals(user: UserIdentity, client: Pick<MatchingClientRow, 'email' | 'phone' | 'dni'>): ClubProfileMatchSignal[] {
    const normalizedUserEmail = normalizeEmail(String(user.email || ''));
    const normalizedUserPhone = normalizeIdentityPhone(user.phoneNumber);
    const normalizedUserDni = String(user.dni || '').replace(/\D/g, '').trim();
    const normalizedClientEmail = normalizeEmail(String(client.email || ''));
    const normalizedClientPhone = normalizeIdentityPhone(client.phone);
    const normalizedClientDni = String(client.dni || '').replace(/\D/g, '').trim();
    const signals: ClubProfileMatchSignal[] = [];

    if (normalizedUserEmail && normalizedClientEmail && normalizedUserEmail === normalizedClientEmail) {
      signals.push('EMAIL');
    }

    if (normalizedUserPhone && normalizedClientPhone) {
      const userVariants = getPhoneIdentityVariants(normalizedUserPhone);
      const clientVariants = getPhoneIdentityVariants(normalizedClientPhone);
      if (clientVariants.some((variant) => userVariants.includes(variant))) {
        signals.push('PHONE');
      }
    }

    if (normalizedUserDni.length >= 6 && normalizedClientDni.length >= 6 && normalizedUserDni === normalizedClientDni) {
      signals.push('DNI');
    }

    return signals;
  }

  private buildSummaryForGroup(group: {
    clubId: number;
    clubName: string;
    clubSlug: string;
    membershipRole: MembershipRole | null;
    clients: MatchingClientRow[];
  }, userId: number, userIdentity?: UserIdentity): ClubProfileSummary {
    const identity = userIdentity || { id: userId, email: null, phoneNumber: null, dni: null };
    const linkedClient = group.clients.find((client) => Number(client.userId || 0) === Number(userId)) || null;
    const freeMatches = group.clients.filter((client) => !client.userId);
    const foreignLinkedMatches = group.clients.filter((client) => Number(client.userId || 0) > 0 && Number(client.userId || 0) !== Number(userId));
    const groupSignals = Array.from(
      new Set(group.clients.flatMap((client) => this.getMatchSignals(identity, client)))
    ) as ClubProfileMatchSignal[];

    if (linkedClient) {
      return {
        clubId: group.clubId,
        clubName: group.clubName,
        clubSlug: group.clubSlug,
        membershipRole: group.membershipRole,
        status: 'LINKED',
        linkedClientId: String(linkedClient.id),
        candidateClientIds: [String(linkedClient.id)],
        reason: 'Ya tenés un perfil vinculado en este club',
        reasonCode: 'ALREADY_LINKED',
        matchedBy: this.getMatchSignals(identity, linkedClient),
        conflictDetails: null,
        canClaim: false
      };
    }

    if (foreignLinkedMatches.length > 0 || freeMatches.length > 1) {
      const candidateCount = group.clients.length;
      const freeCandidateCount = freeMatches.length;
      const linkedToAnotherUserCount = foreignLinkedMatches.length;
      const reasonCode: ClubProfileReasonCode =
        linkedToAnotherUserCount > 0 && freeCandidateCount > 0
          ? 'MIXED_STRONG_MATCH_CONFLICT'
          : linkedToAnotherUserCount > 0
          ? 'MATCH_LINKED_TO_ANOTHER_USER'
          : 'MULTIPLE_STRONG_MATCHES';
      const reason =
        reasonCode === 'MIXED_STRONG_MATCH_CONFLICT'
          ? 'Encontramos perfiles compatibles, pero al menos uno ya está vinculado a otra cuenta.'
          : reasonCode === 'MATCH_LINKED_TO_ANOTHER_USER'
          ? 'Encontramos un perfil compatible, pero ya está vinculado a otra cuenta.'
          : `Encontramos ${freeCandidateCount} perfiles compatibles y no queremos elegir el incorrecto.`;

      return {
        clubId: group.clubId,
        clubName: group.clubName,
        clubSlug: group.clubSlug,
        membershipRole: group.membershipRole,
        status: 'CONFLICTED',
        linkedClientId: null,
        candidateClientIds: group.clients.map((client) => String(client.id)),
        reason,
        reasonCode,
        matchedBy: groupSignals,
        conflictDetails: {
          candidateCount,
          freeCandidateCount,
          linkedToAnotherUserCount
        },
        canClaim: false
      };
    }

    if (freeMatches.length === 1) {
      const single = freeMatches[0];
      return {
        clubId: group.clubId,
        clubName: group.clubName,
        clubSlug: group.clubSlug,
        membershipRole: group.membershipRole,
        status: 'CLAIMABLE',
        linkedClientId: null,
        candidateClientIds: [String(single.id)],
        reason: 'Encontramos un perfil libre que coincide con tus datos',
        reasonCode: 'UNIQUE_STRONG_MATCH',
        matchedBy: this.getMatchSignals(identity, single),
        conflictDetails: null,
        canClaim: true
      };
    }

    return {
      clubId: group.clubId,
      clubName: group.clubName,
      clubSlug: group.clubSlug,
      membershipRole: group.membershipRole,
      status: 'AVAILABLE',
      linkedClientId: null,
      candidateClientIds: [],
      reason: 'Todavía no tenés un perfil vinculado en este club',
      reasonCode: 'NO_STRONG_MATCH',
      matchedBy: [],
      conflictDetails: null,
      canClaim: false
    };
  }
}

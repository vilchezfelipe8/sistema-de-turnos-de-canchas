export type MembershipLite = {
  clubId: number;
  role?: string;
  club?: {
    id?: number;
    slug?: string | null;
  } | null;
};

export type SessionUser = {
  id?: number;
  role?: string;
  clubId?: number | null;
  club?: {
    id?: number;
    slug?: string | null;
  } | null;
  memberships?: MembershipLite[];
  activeClubId?: number | null;
  activeMembership?: MembershipLite | null;
  slug?: string;
  clubSlug?: string;
  [key: string]: any;
};

const STORAGE_USER_KEY = 'user';
const STORAGE_ACTIVE_CLUB_KEY = 'activeClubId';
const STORAGE_LAST_CLUB_SLUG_KEY = 'lastClubSlug';

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const normalizeClubSlug = (value: unknown): string | null => {
  const slug = String(value || '').trim();
  return slug ? slug : null;
};

const membershipPriority = (role?: string | null) => {
  if (role === 'OWNER') return 0;
  if (role === 'ADMIN') return 1;
  if (role === 'STAFF') return 2;
  if (role === 'CUSTOMER') return 3;
  return 99;
};

export const getStoredUser = (): SessionUser | null => {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const getStoredActiveClubId = (): number | null => {
  if (typeof window === 'undefined') return null;
  return toPositiveInt(localStorage.getItem(STORAGE_ACTIVE_CLUB_KEY));
};

export const normalizeSessionUser = (user: SessionUser | null): SessionUser | null => {
  if (!user) return null;

  const memberships = Array.isArray(user.memberships)
    ? user.memberships
        .map((membership) => {
          const clubId = toPositiveInt(membership?.clubId ?? membership?.club?.id);
          if (!clubId) return null;
          return {
            ...membership,
            clubId,
            club: membership?.club
              ? {
                  ...membership.club,
                  id: toPositiveInt(membership.club.id) ?? clubId,
                  slug: membership.club.slug || null
                }
              : null
          } as MembershipLite;
        })
        .filter((membership): membership is MembershipLite => Boolean(membership))
    : [];

  memberships.sort((left, right) => {
    const leftPriority = membershipPriority(left.role);
    const rightPriority = membershipPriority(right.role);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.clubId - right.clubId;
  });

  if (memberships.length === 0) {
    return {
      ...user,
      clubId: null,
      memberships: [],
      activeClubId: null,
      activeMembership: null
    };
  }

  const preferredMembership =
    memberships.find((membership) => membership.role === 'OWNER' || membership.role === 'ADMIN') ||
    memberships[0] ||
    null;

  const preferredActiveClubId =
    toPositiveInt(user.activeClubId) ||
    toPositiveInt(user.activeMembership?.clubId) ||
    getStoredActiveClubId() ||
    preferredMembership?.clubId ||
    memberships[0]?.clubId ||
    null;

  const normalizedActiveClubId =
    preferredActiveClubId && memberships.some((membership) => membership.clubId === preferredActiveClubId)
      ? preferredActiveClubId
      : memberships[0]?.clubId || null;

  const activeMembership =
    memberships.find((membership) => membership.clubId === normalizedActiveClubId) || null;

  return {
    ...user,
    clubId: normalizedActiveClubId,
    memberships,
    activeClubId: normalizedActiveClubId,
    activeMembership
  };
};

export const persistSessionUser = (rawUser: SessionUser | null): SessionUser | null => {
  if (typeof window === 'undefined') return rawUser;
  if (!rawUser) {
    localStorage.removeItem(STORAGE_USER_KEY);
    localStorage.removeItem(STORAGE_ACTIVE_CLUB_KEY);
    return null;
  }

  const normalized = normalizeSessionUser(rawUser);
  if (!normalized) return null;

  localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(normalized));
  if (normalized.activeClubId) {
    localStorage.setItem(STORAGE_ACTIVE_CLUB_KEY, String(normalized.activeClubId));
  } else {
    localStorage.removeItem(STORAGE_ACTIVE_CLUB_KEY);
  }

  const activeSlug = getActiveClubSlug(normalized);
  if (activeSlug) {
    localStorage.setItem(STORAGE_LAST_CLUB_SLUG_KEY, activeSlug);
  }

  return normalized;
};

export const setLastClubSlug = (slug: string | null | undefined) => {
  if (typeof window === 'undefined') return;
  const normalized = normalizeClubSlug(slug);
  if (!normalized) return;
  localStorage.setItem(STORAGE_LAST_CLUB_SLUG_KEY, normalized);
};

export const getLastClubSlug = (): string | null => {
  if (typeof window === 'undefined') return null;
  return normalizeClubSlug(localStorage.getItem(STORAGE_LAST_CLUB_SLUG_KEY));
};

export const setActiveClubId = (clubId: number): SessionUser | null => {
  if (typeof window === 'undefined') return null;
  const parsed = toPositiveInt(clubId);
  if (!parsed) return getStoredUser();

  const user = normalizeSessionUser(getStoredUser());
  if (!user) {
    localStorage.setItem(STORAGE_ACTIVE_CLUB_KEY, String(parsed));
    return null;
  }

  const nextUser = normalizeSessionUser({ ...user, activeClubId: parsed });
  return persistSessionUser(nextUser);
};

export const getEffectiveActiveClubId = (user?: SessionUser | null): number | null => {
  const normalized = normalizeSessionUser(user ?? getStoredUser());
  return normalized?.activeClubId || null;
};

export const getActiveClubSlug = (user?: SessionUser | null): string | null => {
  const normalized = normalizeSessionUser(user ?? getStoredUser());
  if (!normalized) return null;

  const activeClubId = normalized.activeClubId;
  if (!activeClubId) return null;

  const membership = normalized.memberships?.find((item) => item.clubId === activeClubId);
  const slug = membership?.club?.slug;
  if (typeof slug === 'string' && slug.trim()) return slug.trim();

  return null;
};

export const getActiveMembershipRole = (user?: SessionUser | null): string | null => {
  const normalized = normalizeSessionUser(user ?? getStoredUser());
  return normalized?.activeMembership?.role || null;
};

export const hasAdminAccess = (user?: SessionUser | null): boolean => {
  const normalized = normalizeSessionUser(user ?? getStoredUser());
  if (!normalized) return false;
  const activeRole = normalized.activeMembership?.role;
  return activeRole === 'OWNER' || activeRole === 'ADMIN';
};

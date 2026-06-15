// src/services/AuthService.ts

import { getApiUrl } from '../utils/apiUrl';
import { getEffectiveActiveClubId, persistSessionUser } from '../utils/session';
import { buildCsrfHeaders } from '../utils/csrf';
import { throwApiErrorFromResponse } from '../utils/apiError';

const apiBase = () => `${getApiUrl()}/api`;
export const AUTH_LOGOUT_EVENT = 'auth:logout';
export const AUTH_LOGIN_EVENT = 'auth:login';
export const AUTH_SYNC_STORAGE_KEY = 'auth:sync';
const AUTH_SYNC_CHANNEL_NAME = 'auth';
const LOGOUT_REDIRECT_STORAGE_KEY = 'auth:logout:pending-redirect';
export const RECENT_LOGOUT_TS_STORAGE_KEY = 'auth:logout:ts';
const LOGOUT_REDIRECT_TTL_MS = 12000;
export interface AuthLogoutEventDetail {
  redirectTo: string | null;
  reason: AuthLogoutReason;
}

export type AuthLogoutReason =
  | 'manual'
  | 'session_expired'
  | 'session_invalid'
  | 'session_revoked';

type PendingLogoutRedirect = {
  target: string;
  ts: number;
};
type AuthSyncAction = 'login' | 'logout';
type AuthSyncPayload = {
  action: AuthSyncAction;
  ts: number;
  id: string;
};

let authSyncChannel: BroadcastChannel | null = null;
let logoutInFlight = false;
let logoutUnlockTimeout: number | null = null;
let logoutNavigationScheduled = false;
let logoutRedirectTarget: string | null = null;
const LOGOUT_IDEMPOTENCY_WINDOW_MS = 6000;

const PRIVATE_PATH_PREFIXES = ['/admin'];
const PRIVATE_EXACT_PATHS = new Set(['/perfil', '/bookings']);

const isPrivatePath = (pathname: string) => {
  const safePath = String(pathname || '').trim();
  if (!safePath) return false;
  if (PRIVATE_EXACT_PATHS.has(safePath)) return true;
  if (safePath.startsWith('/club/') && safePath.includes('/admin')) return true;
  return PRIVATE_PATH_PREFIXES.some((prefix) => safePath.startsWith(prefix));
};

const resolveDefaultLogoutRedirect = (): string | null => {
  if (typeof window === 'undefined') return null;
  const pathname = String(window.location.pathname || '');
  const search = String(window.location.search || '');
  const currentPath = `${pathname}${search}`;

  if (!isPrivatePath(pathname)) {
    return null;
  }

  return `/login?from=${encodeURIComponent(currentPath || '/')}`;
};

const getAuthSyncChannel = (): BroadcastChannel | null => {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!authSyncChannel) {
    authSyncChannel = new BroadcastChannel(AUTH_SYNC_CHANNEL_NAME);
  }
  return authSyncChannel;
};

const emitAuthSync = (action: AuthSyncAction) => {
  if (typeof window === 'undefined') return;
  const payload: AuthSyncPayload = {
    action,
    ts: Date.now(),
    id:
      (typeof crypto !== 'undefined' && (crypto as any).randomUUID
        ? (crypto as any).randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`)
  };
  try {
    localStorage.setItem(AUTH_SYNC_STORAGE_KEY, JSON.stringify(payload));
    // Fuerza propagación consistente incluso cuando hay eventos muy seguidos.
    setTimeout(() => {
      try {
        localStorage.removeItem(AUTH_SYNC_STORAGE_KEY);
      } catch {
      }
    }, 0);
  } catch {
  }
  try {
    getAuthSyncChannel()?.postMessage(payload);
  } catch {
  }
};

const setPendingLogoutRedirect = (target: string) => {
  if (typeof window === 'undefined') return;
  const payload: PendingLogoutRedirect = { target, ts: Date.now() };
  sessionStorage.setItem(LOGOUT_REDIRECT_STORAGE_KEY, JSON.stringify(payload));
};

const postSessionEndpoint = async (path: string) => {
  try {
    const headers = await buildCsrfHeaders();
    await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers,
      credentials: 'include'
    });
  } catch {
  }
};

const fetchSessionMe = async () => {
  const headers: Record<string, string> = {};
  const activeClubId = getActiveClubId();
  if (activeClubId) headers['x-active-club-id'] = String(activeClubId);

  const sessionResponse = await fetch(`${apiBase()}/auth/session/me`, {
    method: 'GET',
    headers,
    credentials: 'include'
  });
  if (sessionResponse.status !== 404) {
    return sessionResponse;
  }

  return fetch(`${apiBase()}/auth/me`, {
    method: 'GET',
    headers,
    credentials: 'include'
  });
};

export const clearPendingLogoutRedirect = () => {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(LOGOUT_REDIRECT_STORAGE_KEY);
};

export const getPendingLogoutRedirect = (): string | null => {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(LOGOUT_REDIRECT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingLogoutRedirect;
    const target = String(parsed?.target || '').trim();
    const ts = Number(parsed?.ts || 0);
    if (!target || !Number.isFinite(ts) || Date.now() - ts > LOGOUT_REDIRECT_TTL_MS) {
      clearPendingLogoutRedirect();
      return null;
    }
    return target;
  } catch {
    clearPendingLogoutRedirect();
    return null;
  }
};

export const login = async (email: string, password: string) => {
  const headers = await buildCsrfHeaders({
    'Content-Type': 'application/json',
  });
  const response = await fetch(`${apiBase()}/auth/login`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    await throwApiErrorFromResponse(response, 'No se pudo iniciar sesión.');
  }

  const data = await response.json();

  // Cookie-first: no persistimos bearer en localStorage.
  localStorage.removeItem('token');

  if (data.user) {
    persistSessionUser(data.user);
  }
  clearPendingLogoutRedirect();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_LOGIN_EVENT));
    emitAuthSync('login');
  }

  return data;
};

export const requestMagicLink = async (email: string) => {
  const headers = await buildCsrfHeaders({
    'Content-Type': 'application/json',
  });
  const response = await fetch(`${apiBase()}/auth/email/request-link`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    await throwApiErrorFromResponse(response, 'No se pudo enviar el enlace.');
  }
  const data = await response.json().catch(() => ({}));
  return data;
};

const buildOAuthStartUrl = (
  provider: 'google' | 'apple' | 'facebook',
  returnTo?: string | null,
  intent: 'login' | 'connect' = 'login'
) => {
  if (typeof window === 'undefined') return null;
  const safeReturnTo =
    typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')
      ? returnTo
      : '/';
  const url = new URL(`${apiBase()}/auth/oauth/${provider}/start`, window.location.origin);
  if (safeReturnTo && safeReturnTo !== '/') {
    url.searchParams.set('returnTo', safeReturnTo);
  }
  if (intent === 'connect') {
    url.searchParams.set('intent', 'connect');
  }
  return url;
};

export const beginGoogleOAuthLogin = (returnTo?: string | null) => {
  if (typeof window === 'undefined') return;
  const url = buildOAuthStartUrl('google', returnTo, 'login');
  if (!url) return;
  window.location.assign(url.toString());
};

export const beginAppleOAuthLogin = (returnTo?: string | null) => {
  if (typeof window === 'undefined') return;
  const url = buildOAuthStartUrl('apple', returnTo, 'login');
  if (!url) return;
  window.location.assign(url.toString());
};

export const beginFacebookOAuthLogin = (returnTo?: string | null) => {
  if (typeof window === 'undefined') return;
  const url = buildOAuthStartUrl('facebook', returnTo, 'login');
  if (!url) return;
  window.location.assign(url.toString());
};

export const beginGoogleOAuthConnect = (returnTo: string = '/perfil') => {
  if (typeof window === 'undefined') return;
  const url = buildOAuthStartUrl('google', returnTo, 'connect');
  if (!url) return;
  window.location.assign(url.toString());
};

export const beginAppleOAuthConnect = (returnTo: string = '/perfil') => {
  if (typeof window === 'undefined') return;
  const url = buildOAuthStartUrl('apple', returnTo, 'connect');
  if (!url) return;
  window.location.assign(url.toString());
};

export const beginFacebookOAuthConnect = (returnTo: string = '/perfil') => {
  if (typeof window === 'undefined') return;
  const url = buildOAuthStartUrl('facebook', returnTo, 'connect');
  if (!url) return;
  window.location.assign(url.toString());
};

export const verifyMagicLink = async (token: string) => {
  const response = await fetch(`${apiBase()}/auth/email/verify?format=json&token=${encodeURIComponent(token)}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    await throwApiErrorFromResponse(response, 'El enlace es inválido o expiró.');
  }
  const data = await response.json().catch(() => ({}));

  // Cookie-first: limpiamos token legacy siempre.
  localStorage.removeItem('token');

  if (data?.user) {
    persistSessionUser(data.user);
    clearPendingLogoutRedirect();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_LOGIN_EVENT));
      emitAuthSync('login');
    }
    return data;
  }

  const meResponse = await fetchSessionMe();
  if (meResponse.ok) {
    const sessionUser = await meResponse.json();
    persistSessionUser(sessionUser);
    clearPendingLogoutRedirect();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_LOGIN_EVENT));
      emitAuthSync('login');
    }
    return { ...data, user: sessionUser };
  }

  throw new Error('No se pudo iniciar sesión con el enlace.');
};

export type OAuthIdentitySummary = {
  id: string;
  provider: 'GOOGLE' | 'APPLE' | 'FACEBOOK' | string;
  providerEmail: string | null;
  providerEmailVerified: boolean;
  profilePhotoUrl?: string | null;
  linkedAt: string;
  lastLoginAt: string;
};

export type SessionSecuritySummary = {
  id: string;
  status: 'ACTIVE' | 'ROTATED' | 'REVOKED' | 'EXPIRED' | string;
  ip: string | null;
  userAgent: string | null;
  deviceLabel: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  isCurrent: boolean;
};

export type AccountSecurityOverview = {
  oauthIdentities: OAuthIdentitySummary[];
  sessions: SessionSecuritySummary[];
  currentSessionId: string | null;
  clubProfiles: ClubProfileSummary[];
};

export type ClubProfileSummary = {
  clubId: number;
  clubName: string;
  clubSlug: string;
  membershipRole: string | null;
  status: 'LINKED' | 'CLAIMABLE' | 'CONFLICTED' | 'AVAILABLE' | string;
  linkedClientId: string | null;
  candidateClientIds: string[];
  reason: string;
  reasonCode:
    | 'ALREADY_LINKED'
    | 'UNIQUE_STRONG_MATCH'
    | 'MULTIPLE_STRONG_MATCHES'
    | 'MATCH_LINKED_TO_ANOTHER_USER'
    | 'MIXED_STRONG_MATCH_CONFLICT'
    | 'NO_STRONG_MATCH'
    | string;
  matchedBy: Array<'EMAIL' | 'PHONE' | 'DNI' | string>;
  conflictDetails: {
    candidateCount: number;
    freeCandidateCount: number;
    linkedToAnotherUserCount: number;
  } | null;
  canClaim: boolean;
};

export const getAccountSecurityOverview = async (): Promise<AccountSecurityOverview> => {
  const headers: Record<string, string> = {};
  const activeClubId = getActiveClubId();
  if (activeClubId) headers['x-active-club-id'] = String(activeClubId);

  const response = await fetch(`${apiBase()}/auth/account/security`, {
    method: 'GET',
    headers,
    credentials: 'include'
  });

  if (!response.ok) {
    await throwApiErrorFromResponse(response, 'No se pudo cargar la seguridad de la cuenta.');
  }

  return response.json();
};

export const disconnectGoogleOAuth = async () => {
  return disconnectOAuthProvider('google', 'No se pudo desconectar Google.');
};

export const disconnectAppleOAuth = async () => {
  return disconnectOAuthProvider('apple', 'No se pudo desconectar Apple.');
};

export const disconnectFacebookOAuth = async () => {
  return disconnectOAuthProvider('facebook', 'No se pudo desconectar Facebook.');
};

const disconnectOAuthProvider = async (provider: 'google' | 'apple' | 'facebook', fallbackMessage: string) => {
  const headers = await buildCsrfHeaders();
  const activeClubId = getActiveClubId();
  if (activeClubId) headers['x-active-club-id'] = String(activeClubId);

  const response = await fetch(`${apiBase()}/auth/oauth/${provider}/disconnect`, {
    method: 'POST',
    headers,
    credentials: 'include'
  });

  if (!response.ok) {
    await throwApiErrorFromResponse(response, fallbackMessage);
  }
};

export const logoutAllSessions = async () => {
  const headers = await buildCsrfHeaders();
  const activeClubId = getActiveClubId();
  if (activeClubId) headers['x-active-club-id'] = String(activeClubId);

  const response = await fetch(`${apiBase()}/auth/session/logout-all`, {
    method: 'POST',
    headers,
    credentials: 'include'
  });

  if (!response.ok) {
    await throwApiErrorFromResponse(response, 'No se pudieron cerrar todas las sesiones.');
  }
};

export const claimClubProfile = async (clubId: number): Promise<{ profile: ClubProfileSummary }> => {
  const headers = await buildCsrfHeaders();
  const activeClubId = getActiveClubId();
  if (activeClubId) headers['x-active-club-id'] = String(activeClubId);

  const response = await fetch(`${apiBase()}/auth/account/club-profiles/${encodeURIComponent(String(clubId))}/claim`, {
    method: 'POST',
    headers,
    credentials: 'include'
  });

  if (!response.ok) {
    await throwApiErrorFromResponse(response, 'No se pudo vincular tu perfil en este club.');
  }

  return response.json();
};

export const register = async (
  firstName: string,
  lastName: string,
  email: string,
  password: string,
  phoneNumber: string,
  role: string,
  dni?: string,
  phoneCountryCode?: string,
  phoneNumberLocal?: string
) => {
  const headers = await buildCsrfHeaders({
    'Content-Type': 'application/json',
  });
  const response = await fetch(`${apiBase()}/auth/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      firstName,
      lastName,
      email,
      password,
      phoneNumber,
      ...(phoneCountryCode ? { phoneCountryCode } : {}),
      ...(phoneNumberLocal ? { phoneNumberLocal } : {}),
      role,
      ...(dni ? { dni } : {})
    }),
  });

  if (!response.ok) {
    await throwApiErrorFromResponse(response, 'No se pudo crear la cuenta.');
  }

  const data = await response.json();
  return data;
};

export const logout = (options?: { redirectTo?: string | null; reason?: AuthLogoutReason }) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(RECENT_LOGOUT_TS_STORAGE_KEY, String(Date.now()));
  } catch {
  }

  const explicitTarget = String(options?.redirectTo || '').trim();
  const fallbackTarget = explicitTarget ? null : resolveDefaultLogoutRedirect();
  const target = explicitTarget || fallbackTarget || '';
  if (target) {
    logoutRedirectTarget = logoutRedirectTarget || target;
    setPendingLogoutRedirect(logoutRedirectTarget);
  } else if (!logoutRedirectTarget) {
    clearPendingLogoutRedirect();
  }

  if (logoutInFlight) {
    if (logoutRedirectTarget && !logoutNavigationScheduled) {
      logoutNavigationScheduled = true;
      window.setTimeout(() => {
        const currentPath = `${window.location.pathname}${window.location.search}`;
        if (logoutRedirectTarget && currentPath !== logoutRedirectTarget) {
          window.location.assign(logoutRedirectTarget);
        }
      }, 180);
    }
    return;
  }

  logoutInFlight = true;
  void postSessionEndpoint('/auth/session/logout');

  // Limpiar token y datos del usuario en localStorage.
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('activeClubId');

  const detail: AuthLogoutEventDetail = {
    redirectTo: logoutRedirectTarget || null,
    reason: options?.reason || 'manual'
  };
  window.dispatchEvent(new CustomEvent<AuthLogoutEventDetail>(AUTH_LOGOUT_EVENT, { detail }));
  emitAuthSync('logout');

  if (logoutRedirectTarget && !logoutNavigationScheduled) {
    logoutNavigationScheduled = true;
    window.setTimeout(() => {
      const currentPath = `${window.location.pathname}${window.location.search}`;
      if (logoutRedirectTarget && currentPath !== logoutRedirectTarget) {
        window.location.assign(logoutRedirectTarget);
      } else {
        clearPendingLogoutRedirect();
      }
    }, 180);
  }

  if (logoutUnlockTimeout) {
    clearTimeout(logoutUnlockTimeout);
  }
  logoutUnlockTimeout = window.setTimeout(() => {
    logoutInFlight = false;
    logoutNavigationScheduled = false;
    logoutRedirectTarget = null;
    clearPendingLogoutRedirect();
    logoutUnlockTimeout = null;
  }, LOGOUT_IDEMPOTENCY_WINDOW_MS);
};

export const getActiveClubId = () => getEffectiveActiveClubId();

export const updateMyProfile = async (payload: {
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  phoneCountryCode?: string;
  phoneNumberLocal?: string;
  dni?: string;
}) => {

  const headers = await buildCsrfHeaders({
    'Content-Type': 'application/json',
  });
  const activeClubId = getActiveClubId();
  if (activeClubId) headers['x-active-club-id'] = String(activeClubId);

  const response = await fetch(`${apiBase()}/auth/me`, {
    method: 'PATCH',
    headers,
    credentials: 'include',
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    await throwApiErrorFromResponse(response, 'No se pudo actualizar el perfil.');
  }
  const data = await response.json().catch(() => ({}));

  if (data) {
    persistSessionUser(data);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_LOGIN_EVENT));
      emitAuthSync('login');
    }
  }

  return data;
};

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getApiUrl } from '../utils/apiUrl';
import {
  AUTH_LOGIN_EVENT,
  AUTH_LOGOUT_EVENT,
  AUTH_SYNC_STORAGE_KEY,
  RECENT_LOGOUT_TS_STORAGE_KEY,
  logout
} from '../services/AuthService';
import { getActiveClubId } from '../services/AuthService';
import { normalizeSessionUser, persistSessionUser, type MembershipLite } from '../utils/session';

export interface AuthUser {
  id: number;
  firstName: string;
  lastName: string;
  name?: string;
  email: string;
  phoneNumber: string | null;
  phone?: string | null;
  role: string;
  clubId: number | null;
  memberships?: MembershipLite[];
  activeClubId?: number | null;
  activeMembership?: MembershipLite | null;
  club?: { id?: number; slug?: string | null } | null;
}

export type AuthStatus = 'unknown' | 'authenticated' | 'guest';

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  isAuthenticated: boolean;
  revalidateSession: () => Promise<void>;
  setGuest: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const apiBase = () => `${getApiUrl()}/api`;
const SESSION_ME_PROBE_THROTTLE_MS = 1200;
const RECENT_LOGOUT_GRACE_MS = 6000;
let lastGlobalSessionProbeAt = 0;

const parseAuthSyncAction = (raw: unknown): 'login' | 'logout' | null => {
  if (raw == null) return null;
  try {
    const parsed =
      typeof raw === 'string'
        ? (JSON.parse(raw) as { action?: unknown })
        : (raw as { action?: unknown });
    const action = String(parsed?.action || '').trim();
    if (action === 'login' || action === 'logout') return action;
    return null;
  } catch {
    return null;
  }
};

const parseAuthCode = async (response: Response): Promise<string | null> => {
  try {
    const json = await response.clone().json();
    return typeof json?.code === 'string' ? json.code : null;
  } catch {
    return null;
  }
};

const isGuestAuthCode = (code: string | null) =>
  code === 'AUTH_MISSING' ||
  code === 'AUTH_INVALID' ||
  code === 'AUTH_EXPIRED' ||
  code === 'AUTH_REVOKED';

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [status, setStatus] = useState<AuthStatus>('unknown');
  const [user, setUser] = useState<AuthUser | null>(null);
  const revalidateInFlightRef = useRef<Promise<void> | null>(null);
  const lastValidateAtRef = useRef<number>(0);

  const setGuest = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('user');
    }
    setUser(null);
    setStatus('guest');
  }, []);

  const applyAuthenticated = useCallback((nextUser: AuthUser) => {
    const normalized = normalizeSessionUser(nextUser as any) as AuthUser | null;
    if (normalized) {
      persistSessionUser(normalized as any);
      setUser(normalized);
    } else {
      persistSessionUser(nextUser as any);
      setUser(nextUser);
    }
    setStatus('authenticated');
  }, []);

  const requestSessionMe = useCallback(async () => {
    const headers = new Headers();
    const activeClubId = getActiveClubId();
    if (activeClubId) {
      headers.set('x-active-club-id', String(activeClubId));
    }

    const sessionResponse = await fetch(`${apiBase()}/auth/session/me`, {
      method: 'GET',
      headers,
      credentials: 'include'
    });

    if (sessionResponse.status === 404) {
      const legacyResponse = await fetch(`${apiBase()}/auth/me`, {
        method: 'GET',
        headers,
        credentials: 'include'
      });
      return legacyResponse;
    }

    return sessionResponse;
  }, []);

  const tryRefreshSession = useCallback(async () => {
    const headers = new Headers();
    const activeClubId = getActiveClubId();
    if (activeClubId) {
      headers.set('x-active-club-id', String(activeClubId));
    }

    const refreshResponse = await fetch(`${apiBase()}/auth/session/refresh`, {
      method: 'POST',
      headers,
      credentials: 'include'
    });

    return refreshResponse.ok;
  }, []);

  const revalidateSession = useCallback(async () => {
    if (revalidateInFlightRef.current) {
      return revalidateInFlightRef.current;
    }

    const now = Date.now();
    if (now - lastGlobalSessionProbeAt < SESSION_ME_PROBE_THROTTLE_MS) {
      return;
    }

    if (typeof window !== 'undefined') {
      const rawRecentLogoutTs = sessionStorage.getItem(RECENT_LOGOUT_TS_STORAGE_KEY);
      const recentLogoutTs = Number(rawRecentLogoutTs || 0);
      if (Number.isFinite(recentLogoutTs) && now - recentLogoutTs < RECENT_LOGOUT_GRACE_MS) {
        setGuest();
        lastValidateAtRef.current = now;
        return;
      }
    }

    const task = (async () => {
      try {
        lastGlobalSessionProbeAt = Date.now();
        const response = await requestSessionMe();

        if (response.ok) {
          const payload = (await response.json()) as AuthUser;
          applyAuthenticated(payload);
          return;
        }

        if (response.status === 401 || response.status === 403) {
          const code = await parseAuthCode(response);
          if (code === 'AUTH_EXPIRED' || code === 'AUTH_INVALID' || code === 'AUTH_MISSING') {
            try {
              const refreshed = await tryRefreshSession();
              if (refreshed) {
                const retriedResponse = await requestSessionMe();
                if (retriedResponse.ok) {
                  const retriedPayload = (await retriedResponse.json()) as AuthUser;
                  applyAuthenticated(retriedPayload);
                  return;
                }
              }
            } catch {
              // Si falla refresh seguimos al flujo guest.
            }
          }
          if (isGuestAuthCode(code) || response.status === 401) {
            setGuest();
            return;
          }
        }

        if (status === 'unknown') {
          setGuest();
        }
      } catch {
        if (status === 'unknown') {
          setGuest();
        }
      } finally {
        lastValidateAtRef.current = Date.now();
        revalidateInFlightRef.current = null;
      }
    })();

    revalidateInFlightRef.current = task;
    return task;
  }, [applyAuthenticated, requestSessionMe, setGuest, status, tryRefreshSession]);

  useEffect(() => {
    void revalidateSession();
  }, [revalidateSession]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const revalidateOnLogin = () => {
      void revalidateSession();
    };
    const applyLogout = () => {
      setGuest();
    };
    const handleStorage = (event: StorageEvent) => {
      if (String(event.key || '') !== AUTH_SYNC_STORAGE_KEY) return;
      const action = parseAuthSyncAction(event.newValue);
      if (action === 'logout') {
        setGuest();
        return;
      }
      if (action === 'login') {
        void revalidateSession();
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastValidateAtRef.current < 15000) return;
      void revalidateSession();
    };
    const handleFocus = () => {
      if (Date.now() - lastValidateAtRef.current < 15000) return;
      void revalidateSession();
    };

    let authSyncChannel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      authSyncChannel = new BroadcastChannel('auth');
      authSyncChannel.onmessage = (event: MessageEvent) => {
        const action = parseAuthSyncAction(event.data);
        if (action === 'logout') {
          setGuest();
          return;
        }
        if (action === 'login') {
          void revalidateSession();
        }
      };
    }

    window.addEventListener(AUTH_LOGIN_EVENT, revalidateOnLogin);
    window.addEventListener(AUTH_LOGOUT_EVENT, applyLogout);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener(AUTH_LOGIN_EVENT, revalidateOnLogin);
      window.removeEventListener(AUTH_LOGOUT_EVENT, applyLogout);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (authSyncChannel) authSyncChannel.close();
    };
  }, [revalidateSession, setGuest]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isAuthenticated: status === 'authenticated' && Boolean(user),
      revalidateSession,
      setGuest
    }),
    [revalidateSession, setGuest, status, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return ctx;
};

export const forceGuestAuthState = () => {
  if (typeof window === 'undefined') return;
  logout();
};

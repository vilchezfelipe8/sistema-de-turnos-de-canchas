import { getApiUrl } from './apiUrl';
import { getActiveClubId, logout } from '../services/AuthService';
import { getActiveClubSlug } from './session';

type ApiErrorCode =
  | 'AUTH_MISSING'
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'AUTH_REVOKED'
  | 'AUTH_FORBIDDEN'
  | 'AUTH_CONTEXT_INVALID'
  | string;

type ParsedApiError = {
  code: ApiErrorCode | null;
  message: string;
};

export class AuthSessionInvalidatedError extends Error {
  public readonly code: ApiErrorCode;
  public readonly status: number;

  constructor(code: ApiErrorCode, status: number) {
    super('Sesión finalizada.');
    this.name = 'AuthSessionInvalidatedError';
    this.code = code;
    this.status = status;
  }
}

let refreshInFlight: Promise<boolean> | null = null;
let logoutInvalidationInFlight = false;
const LOGOUT_INVALIDATION_COOLDOWN_MS = 6000;

const parseApiError = async (res: Response): Promise<ParsedApiError> => {
  try {
    const data = await res.clone().json();
    const nested = data?.error && typeof data.error === 'object' ? data.error : null;
    const code =
      typeof data?.code === 'string'
        ? data.code
        : typeof nested?.code === 'string'
          ? nested.code
          : null;
    const message =
      typeof data?.error === 'string'
        ? data.error
        : typeof nested?.message === 'string'
          ? nested.message
          : typeof nested?.error === 'string'
            ? nested.error
        : typeof data?.message === 'string'
          ? data.message
          : '';
    return { code, message };
  } catch {
    try {
      return { code: null, message: (await res.clone().text()) || '' };
    } catch {
      return { code: null, message: '' };
    }
  }
};

const formatMessage = (message: string, fallback: string) => {
  const safe = String(message || '').trim();
  if (!safe) return fallback;
  return safe.charAt(0).toUpperCase() + safe.slice(1);
};

const isRefreshTriggerCode = (code: ApiErrorCode | null) =>
  code === 'AUTH_EXPIRED' || code === 'AUTH_INVALID' || code === 'AUTH_MISSING';

const isSessionInvalidCode = (code: ApiErrorCode | null) =>
  code === 'AUTH_INVALID' || code === 'AUTH_EXPIRED' || code === 'AUTH_REVOKED' || code === 'AUTH_MISSING';

export const isAuthSessionInvalidCode = (code: ApiErrorCode | null) => isSessionInvalidCode(code);

export const isAuthSessionInvalidatedError = (value: unknown): value is AuthSessionInvalidatedError =>
  value instanceof AuthSessionInvalidatedError;

const buildHeaders = (init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  const activeClubId = getActiveClubId();
  if (activeClubId) {
    headers.set('x-active-club-id', String(activeClubId));
  }
  return headers;
};

const resolveAdminLogoutRedirect = (): string | null => {
  if (typeof window === 'undefined') return null;

  const path = String(window.location.pathname || '');
  const isAdminRoot = path.startsWith('/admin');
  const clubAdminMatch = path.match(/^\/club\/([^/]+)\/admin(?:\/|$)/i);
  const slugFromPath = clubAdminMatch?.[1] ? decodeURIComponent(clubAdminMatch[1]).trim() : '';

  if (slugFromPath) {
    return `/club/${slugFromPath}`;
  }
  if (!isAdminRoot) {
    return null;
  }

  const activeSlug = getActiveClubSlug();
  if (activeSlug) {
    return `/club/${activeSlug}`;
  }

  return null;
};

const resolveLogoutReason = (code: ApiErrorCode | null) => {
  if (code === 'AUTH_EXPIRED') return 'session_expired';
  if (code === 'AUTH_REVOKED') return 'session_revoked';
  return 'session_invalid';
};

const triggerLogoutInvalidation = (redirectTo: string | null, code: ApiErrorCode | null) => {
  if (logoutInvalidationInFlight) return;
  logoutInvalidationInFlight = true;
  logout({ redirectTo, reason: resolveLogoutReason(code) });
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      logoutInvalidationInFlight = false;
    }, LOGOUT_INVALIDATION_COOLDOWN_MS);
  } else {
    logoutInvalidationInFlight = false;
  }
};

const refreshSessionSingleFlight = async (): Promise<boolean> => {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  const task = (async () => {
    try {
      const headers = buildHeaders();
      const response = await fetch(`${getApiUrl()}/api/auth/session/refresh`, {
        method: 'POST',
        headers,
        credentials: 'include'
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  refreshInFlight = task;
  return task;
};

const shouldAttemptRefresh = (url: string, code: ApiErrorCode | null, status: number, retried: boolean) => {
  if (retried) return false;
  if (status !== 401) return false;
  if (!isRefreshTriggerCode(code)) return false;
  return !url.includes('/api/auth/session/refresh');
};

const executeFetchWithAuth = async (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  retried: boolean
): Promise<Response> => {
  const headers = buildHeaders(init);
  const response = await fetch(input, { ...init, headers, credentials: 'include' });
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String((input as any)?.url || '');

  if (response.status !== 401 && response.status !== 403) {
    return response;
  }

  const { code, message } = await parseApiError(response);

  if (shouldAttemptRefresh(url, code, response.status, retried)) {
    const refreshed = await refreshSessionSingleFlight();
    if (refreshed) {
      return executeFetchWithAuth(input, init, true);
    }
  }

  if (response.status === 401) {
    if (isSessionInvalidCode(code)) {
      triggerLogoutInvalidation(resolveAdminLogoutRedirect(), code);
      throw new AuthSessionInvalidatedError(code || 'AUTH_INVALID', response.status);
    }
    throw new Error(formatMessage(message, 'No autorizado'));
  }

  if (response.status === 403) {
    if (code === 'AUTH_FORBIDDEN') {
      throw new Error(formatMessage(message, 'No autorizado'));
    }
    if (isSessionInvalidCode(code)) {
      triggerLogoutInvalidation(resolveAdminLogoutRedirect(), code);
      throw new AuthSessionInvalidatedError(code || 'AUTH_INVALID', response.status);
    }
    throw new Error(formatMessage(message, 'No autorizado'));
  }

  return response;
};

export async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return executeFetchWithAuth(input, init, false);
}

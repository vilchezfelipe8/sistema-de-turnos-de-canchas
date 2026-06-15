import { getApiUrl } from './apiUrl';

export const CSRF_HEADER_NAME = 'X-CSRF-Token';
const CSRF_COOKIE_NAME = 'tc_csrf';

let csrfTokenCache: string | null = null;
let csrfRequestInFlight: Promise<string | null> | null = null;

const readCookie = (name: string): string | null => {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const part = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));
  if (!part) return null;
  return decodeURIComponent(part.slice(prefix.length)).trim() || null;
};

export const getCsrfToken = (): string | null => {
  const fromCookie = readCookie(CSRF_COOKIE_NAME);
  if (fromCookie) {
    csrfTokenCache = fromCookie;
    return fromCookie;
  }
  return csrfTokenCache;
};

export const ensureCsrfToken = async (): Promise<string | null> => {
  const existing = getCsrfToken();
  if (existing) return existing;
  if (typeof window === 'undefined') return null;
  if (csrfRequestInFlight) return csrfRequestInFlight;

  csrfRequestInFlight = (async () => {
    try {
      const response = await fetch(`${getApiUrl()}/api/auth/csrf`, {
        method: 'GET',
        credentials: 'include'
      });
      const payload = await response.json().catch(() => ({}));
      const token =
        typeof payload?.csrfToken === 'string' && payload.csrfToken.trim()
          ? payload.csrfToken.trim()
          : getCsrfToken();
      csrfTokenCache = token || null;
      return csrfTokenCache;
    } catch {
      return getCsrfToken();
    } finally {
      csrfRequestInFlight = null;
    }
  })();

  return csrfRequestInFlight;
};

export const buildCsrfHeaders = async (initHeaders?: HeadersInit): Promise<Headers> => {
  const headers = new Headers(initHeaders);
  const token = await ensureCsrfToken();
  if (token) {
    headers.set(CSRF_HEADER_NAME, token);
  }
  return headers;
};

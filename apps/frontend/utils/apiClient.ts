/**
 * Cliente HTTP que añade el token de auth y, si el servidor responde 401 o 403
 * (token expirado o inválido), limpia la sesión (logout).
 */
import { getToken, logout } from '../services/AuthService';
import { getActiveClubId } from '../services/AuthService';
import { getActiveClubSlug } from './session';

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.clone().json();
    if (typeof data?.error === 'string') return data.error;
    if (typeof data?.message === 'string') return data.message;
    return '';
  } catch {
    try {
      return (await res.clone().text()) || '';
    } catch {
      return '';
    }
  }
}

export async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);

    const activeClubId = getActiveClubId();
    if (activeClubId) {
      headers.set('x-active-club-id', String(activeClubId));
    }
  }

  const res = await fetch(input, { ...init, headers });

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

  if (res.status === 401) {
    // 401: token inválido/expirado -> cerrar sesión
    logout({ redirectTo: resolveAdminLogoutRedirect() });
    throw new Error('Sesión expirada. Volvé a iniciar sesión.');
  }

  if (res.status === 403) {
    const errorMessage = (await extractErrorMessage(res)).toLowerCase();
    const isExpiredToken =
      errorMessage.includes('token inválido') ||
      errorMessage.includes('token invalido') ||
      errorMessage.includes('token expirado') ||
      errorMessage.includes('expirado');

    if (isExpiredToken) {
      logout({ redirectTo: resolveAdminLogoutRedirect() });
      throw new Error('Sesión expirada. Volvé a iniciar sesión.');
    }

    // 403 real de permisos: no cerrar sesión
    throw new Error('No autorizado');
  }

  return res;
}

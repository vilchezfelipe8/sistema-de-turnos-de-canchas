// src/services/AuthService.ts

import { getApiUrl } from '../utils/apiUrl';
import { getEffectiveActiveClubId, persistSessionUser } from '../utils/session';

const apiBase = () => `${getApiUrl()}/api`;
export const AUTH_LOGOUT_EVENT = 'auth:logout';
export const AUTH_LOGIN_EVENT = 'auth:login';
const LOGOUT_REDIRECT_STORAGE_KEY = 'auth:logout:pending-redirect';
const LOGOUT_REDIRECT_TTL_MS = 12000;
export interface AuthLogoutEventDetail {
  redirectTo: string | null;
}

type PendingLogoutRedirect = {
  target: string;
  ts: number;
};

const setPendingLogoutRedirect = (target: string) => {
  if (typeof window === 'undefined') return;
  const payload: PendingLogoutRedirect = { target, ts: Date.now() };
  sessionStorage.setItem(LOGOUT_REDIRECT_STORAGE_KEY, JSON.stringify(payload));
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
  const response = await fetch(`${apiBase()}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || errorData.message || 'Error al iniciar sesión');
  }

  const data = await response.json();
  
  // Aquí es donde ocurre la magia: Guardamos el token en el navegador
  if (data.token) {
    localStorage.setItem('token', data.token);
    clearPendingLogoutRedirect();


    // Opcional: Guardar datos del usuario si el back los devuelve
    if (data.user) {
        persistSessionUser(data.user);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_LOGIN_EVENT));
    }
  }

  return data;
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
  const response = await fetch(`${apiBase()}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
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
    const errorData = await response.json();
    throw new Error(errorData.error || errorData.message || 'Error al registrar usuario');
  }

  const data = await response.json();
  return data;
};

export const logout = (options?: { redirectTo?: string | null }) => {
  // Limpiar token y datos del usuario en localStorage.
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('activeClubId');
  if (typeof window !== 'undefined') {
    const target = String(options?.redirectTo || '').trim();
    if (target) {
      setPendingLogoutRedirect(target);
    } else {
      clearPendingLogoutRedirect();
    }
    const detail: AuthLogoutEventDetail = { redirectTo: target || null };
    window.dispatchEvent(new CustomEvent<AuthLogoutEventDetail>(AUTH_LOGOUT_EVENT, { detail }));

    if (target) {
      window.setTimeout(() => {
        const currentPath = `${window.location.pathname}${window.location.search}`;
        if (currentPath !== target) {
          window.location.assign(target);
        }
      }, 180);
    }
  }
};

export const getToken = () => {
    // Esta función la usaremos en las reservas
    if (typeof window !== 'undefined') {
        return localStorage.getItem('token');
    }
    return null;
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
  const token = getToken();
  if (!token) throw new Error('Debes iniciar sesión.');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
  const activeClubId = getActiveClubId();
  if (activeClubId) headers['x-active-club-id'] = String(activeClubId);

  const response = await fetch(`${apiBase()}/auth/me`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || data?.message || 'No se pudo actualizar el perfil');
  }

  if (data) {
    persistSessionUser(data);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_LOGIN_EVENT));
    }
  }

  return data;
};

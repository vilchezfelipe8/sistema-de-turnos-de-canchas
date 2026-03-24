// src/services/AuthService.ts

import { getApiUrl } from '../utils/apiUrl';
import { getEffectiveActiveClubId, persistSessionUser } from '../utils/session';

const apiBase = () => `${getApiUrl()}/api`;
export const AUTH_LOGOUT_EVENT = 'auth:logout';
export const AUTH_LOGIN_EVENT = 'auth:login';

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
    window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
    const target = String(options?.redirectTo || '').trim();
    if (target) {
      window.location.href = target;
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

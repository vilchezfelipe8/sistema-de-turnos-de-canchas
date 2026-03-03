/**
 * Cliente HTTP que añade el token de auth y, si el servidor responde 401 o 403
 * (token expirado o inválido), limpia la sesión (logout). `logout()` redirige
 * automáticamente a `/`.
 */
import { getToken, logout } from '../services/AuthService';

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
  }

  const res = await fetch(input, { ...init, headers });

  if (res.status === 401) {
    // 401: token inválido/expirado -> cerrar sesión
    logout();
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
      logout();
      throw new Error('Sesión expirada. Volvé a iniciar sesión.');
    }

    // 403 real de permisos: no cerrar sesión
    throw new Error('No autorizado');
  }

  return res;
}
